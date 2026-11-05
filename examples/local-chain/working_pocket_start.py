"""WO-07 disposable Windows dev chain. Never connects to a public CKB node."""
from pathlib import Path
import argparse, datetime, hashlib, json, os, re, shutil, socket, subprocess, threading, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import time, urllib.request, zipfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
TAG='v0.210.0'
ARCHIVE='ckb_v0.210.0_x86_64-pc-windows-msvc.zip'
ARCHIVE_SHA='a4f7300e5ed1753ab38fc9a9c234a3134589dc18ea66716acdd2b1d0474c7b83'
URL=f'https://github.com/nervosnetwork/ckb/releases/download/{TAG}/{ARCHIVE}'
SOURCE='https://raw.githubusercontent.com/nervosnetwork/ckb/'+TAG+'/'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x): p.write_text(json.dumps(x,indent=2)+'\n',encoding='utf-8')
def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0)); return s.getsockname()[1]
def rpc(url,method,params=None):
    body=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params or []}).encode()
    req=urllib.request.Request(url,body,{'Content-Type':'application/json'})
    r=json.load(urllib.request.urlopen(req,timeout=15))
    if 'error' in r: raise RuntimeError(r['error'])
    return r['result']
def lost_response_proxy(target_url,target_transaction):
    target=json.dumps(target_transaction,sort_keys=True,separators=(',',':'))
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def do_POST(self):
            body=self.rfile.read(int(self.headers.get('Content-Length','0')))
            request=json.loads(body)
            upstream=urllib.request.Request(target_url,body,{'Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(upstream,timeout=20) as response: result=response.read()
            except Exception as error:
                result=json.dumps({'jsonrpc':'2.0','id':request.get('id'),'error':{'code':-32000,'message':str(error)}}).encode()
            matching=(request.get('method')=='send_transaction' and json.dumps(request.get('params',[{}])[0],sort_keys=True,separators=(',',':'))==target)
            if matching:
                self.server.lost.append({'method':'send_transaction','action':'forwarded to CKB, RPC response intentionally dropped'})
                self.close_connection=True
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(result)));self.end_headers();self.wfile.write(result)
        def log_message(self,*_): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.lost=[]
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    return server,thread,f'http://127.0.0.1:{server.server_port}'
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--ckb',type=Path);ap.add_argument('--run-dir',type=Path);ap.add_argument('--scenario',choices=['app'],default='app');ap.add_argument('--port',type=int,default=4173);ap.add_argument('--resume',action='store_true')
    opts=ap.parse_args();assert os.name=='nt','Only this Windows reproduction path has been qualified'
    started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    cache=Path(os.environ['TEMP'])/'quotacell-wo07-tools';cache.mkdir(exist_ok=True)
    if opts.ckb: exe=opts.ckb.resolve()
    else:
        archive=cache/ARCHIVE
        if not archive.exists() or sha(archive)!=ARCHIVE_SHA:
            partial=cache/(ARCHIVE+'.partial')
            with urllib.request.urlopen(URL,timeout=60) as src, partial.open('wb') as dst:
                shutil.copyfileobj(src,dst)
            assert sha(partial)==ARCHIVE_SHA;partial.replace(archive)
        assert sha(archive)==ARCHIVE_SHA
        found=list(cache.rglob('ckb.exe'))
        if not found:
            with zipfile.ZipFile(archive) as z:
                for n in z.namelist(): assert (cache/n).resolve().is_relative_to(cache.resolve())
                z.extractall(cache)
            found=list(cache.rglob('ckb.exe'))
        assert len(found)==1;exe=found[0]
    assert sha(exe)=='77ff953e9dc3a03b36e38a3cab2b9b06f17be8254a15a23afa826c2d4aea98b0','Unexpected CKB executable bytes'
    run=(opts.run_dir or HERE/'.local'/datetime.datetime.now().strftime('run-%Y%m%d-%H%M%S')).resolve()
    if opts.resume:
        assert opts.run_dir and (run/'runtime.json').is_file() and (run/'context.json').is_file(), 'A previously created run directory is required'
        endpoint=json.loads((run/'runtime.json').read_text())['url']
        assert re.fullmatch(r'http://127\.0\.0\.1:\d+',endpoint)
        process=subprocess.Popen([str(exe),'-C',str(run/'node'),'run'],cwd=HERE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            for _ in range(120):
                if process.poll() is not None: raise RuntimeError('Node exited during restart')
                try: rpc(endpoint,'get_tip_header');break
                except Exception: time.sleep(.5)
            else: raise RuntimeError('Node readiness timeout')
            rpc(endpoint,'set_network_active',[False])
            subprocess.run(['node','--experimental-strip-types',str(HERE/'working_pocket_server.mjs'),str(run),str(opts.port)],cwd=HERE,check=True,env={**os.environ,'QUOTACELL_DEV_SIGNER':'1'})
        finally:
            process.terminate()
            try: process.wait(timeout=20)
            except subprocess.TimeoutExpired: process.kill();process.wait(timeout=10)
        return
    assert not run.exists(),'Use a fresh run directory; no chain data is deleted or reused'
    run.mkdir(parents=True);evidence=run/'evidence';evidence.mkdir()
    log=(run/'execution.log').open('w',encoding='utf-8')
    def command(command):
        print('RUN',*map(str,command),flush=True)
        p=subprocess.run(list(map(str,command)),cwd=HERE,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        log.write(p.stdout);log.flush();print(p.stdout,flush=True)
        if p.returncode: raise RuntimeError(f'Command failed ({p.returncode}): {command[0]}')
        return p.stdout
    version=command([exe,'--version']).strip()
    command(['node',HERE/'pocket-proof.mjs','keys',run])
    actors=json.loads((run/'actors.json').read_text())
    node=run/'node';node.mkdir()
    rpcport,p2pport=port(),port();endpoint=f'http://127.0.0.1:{rpcport}'
    command([exe,'-C',node,'init','--chain','dev','--ba-arg',actors['owner']['lock']['args'],'--rpc-port',rpcport,'--p2p-port',p2pport])
    spec=node/'specs'/'dev.toml';assert spec.exists()
    original=spec.read_text()
    # Keep the four standard system cells/order and dep groups intact.
    # Replace only issued cells: real random K keys, plus one synthetic T cell.
    before=original[:original.index('# Burn')]
    after=original[original.index('[params]'):]
    issued=[]
    for role,capacity in [('owner',1000000),('alice',1000),('ben',1000)]:
        lock=actors[role]['lock'];issued.append(f'''[[genesis.issued_cells]]
capacity = {capacity*100000000}
lock.code_hash = "{lock['codeHash']}"
lock.args = "{lock['args']}"
lock.hash_type = "type"
''')
    lock=actors['owner']['lock']
    issued.append(f'''[[genesis.issued_cells]]
capacity = {154*100000000}
data = "0xc8000000000000000000000000000000"
lock.code_hash = "{lock['codeHash']}"
lock.args = "{lock['args']}"
lock.hash_type = "type"
type.code_hash = "0x50bd8d6680b8b9cf98b73f3c08faf8b2a21914311954118ad6609be6e78a1b95"
type.hash_type = "data1"
type.args = "0x59297894bff4b8f7e1427bf4943b467ba168565d25fe75de207c146debaec14b"
''')
    spec.write_text(before+'\n'.join(issued)+'\n'+after)
    config=node/'ckb.toml';text=config.read_text()
    text=re.sub(r'^listen_addresses = .*$',f'listen_addresses = ["/ip4/127.0.0.1/tcp/{p2pport}"]',text,flags=re.M)
    text=re.sub(r'^max_outbound_peers = .*$', 'max_outbound_peers = 0',text,flags=re.M)
    text=re.sub(r'^discovery_local_address = .*$', 'discovery_local_address = false',text,flags=re.M)
    text=re.sub(r'^modules = .*$', 'modules = ["Net", "Pool", "Miner", "Chain", "Stats", "Experiment", "IntegrationTest"]',text,flags=re.M)
    assert re.search(r'^bootnodes = \[\]',text,re.M)
    config.write_text(text)
    shutil.copyfile(spec,evidence/'dev.toml');shutil.copyfile(config,evidence/'ckb.toml')
    write(run/'runtime.json',{'url':endpoint,'nodeDirectory':str(node)})
    write(evidence/'environment.json',{'startedUTC':started,'ckbVersion':version,'ckbExeSHA256':sha(exe),'ckbTag':TAG,'archiveURL':URL,'archiveSHA256':ARCHIVE_SHA,'nodeVersion':command(['node','--version']).strip(),'npmVersion':command(['npm.cmd','--version']).strip(),'rpcURL':endpoint,'p2pPort':p2pport,'normalSubmission':'send_transaction passthrough; script verification remains enabled','blockProduction':'IntegrationTest.generate_block; normal block processing/verification; no process_block_without_verify or send_test_transaction'})
    stdout=(run/'node.stdout.log').open('w');stderr=(run/'node.stderr.log').open('w')
    process=subprocess.Popen([str(exe),'-C',str(node),'run'],cwd=HERE,stdout=stdout,stderr=stderr,creationflags=subprocess.CREATE_NO_WINDOW)
    write(run/'process.json',{'pid':process.pid,'exe':str(exe),'directory':str(node)})
    try:
        for _ in range(120):
            if process.poll() is not None: raise RuntimeError('Node exited: '+(run/'node.stderr.log').read_text())
            try: rpc(endpoint,'get_tip_header');break
            except Exception: time.sleep(.5)
        else: raise RuntimeError('Node readiness timeout')
        # Disable network activity in addition to loopback binding/no bootnodes.
        rpc(endpoint,'set_network_active',[False])
        command(['node',HERE/'pocket-proof.mjs','setup',run])
        if opts.scenario=='app':
            subprocess.run(['node','--experimental-strip-types',str(HERE/'working_pocket_server.mjs'),str(run),str(opts.port)],cwd=HERE,check=True,env={**os.environ,'QUOTACELL_DEV_SIGNER':'1'})
            return
        if opts.scenario=='wo13':
            command(['node',HERE/'pocket-proof.mjs','native',run])
            write(evidence/'verdict.json',{'verdict':'WO13_NODE_RUN_COMPLETE','startedUTC':started,'finishedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()})
            return
        if opts.scenario=='wo12':
            command(['node',HERE/'wo12-proof.mjs','lifecycle',run])
            write(evidence/'verdict.json',{'verdict':'WO12_NODE_RUN_COMPLETE','startedUTC':started,'finishedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()})
            return
        if opts.scenario=='race':
            builders=[]
            for role,quantity,name in [('alice','20','race-alice'),('ben','20','race-ben')]:
                builders.append(subprocess.Popen(['node',str(HERE/'proof.mjs'),'race-build',str(run),role,quantity,name],cwd=HERE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True))
            for p in builders:
                out,_=p.communicate(timeout=120);log.write(out);log.flush();print(out,flush=True)
                if p.returncode: raise RuntimeError('Independent race builder failed')
            signed=[json.loads((run/(name+'-signed.json')).read_text()) for name in ['race-alice','race-ben']]
            assert signed[0]['transaction']['inputs'][0]['previous_output']==signed[1]['transaction']['inputs'][0]['previous_output']
            assert signed[0]['transaction']['inputs'][2]['previous_output']==signed[1]['transaction']['inputs'][2]['previous_output']
            journal=run/'payment-intents.sqlite'
            for invoice in ['race-invoice-alice','race-invoice-ben']:
                command(['python',HERE/'payment_intents.py',journal,'reserve',invoice])
            for invoice,name in [('race-invoice-alice','race-alice'),('race-invoice-ben','race-ben')]:
                command(['python',HERE/'payment_intents.py',journal,'record',invoice,run/(name+'-signed.json')])
            # A competing process cannot reserve the same invoice after recovery.
            dup=[subprocess.Popen(['python',str(HERE/'payment_intents.py'),str(journal),'reserve','recovery-invoice-1'],cwd=HERE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True) for _ in range(2)]
            dup_results=[]
            for p in dup:
                out,_=p.communicate(timeout=30);dup_results.append(p.returncode);log.write(out);log.flush();print(out,flush=True)
            assert sorted(dup_results)==[0,3],f'Expected one invoice reservation winner: {dup_results}'
            write(evidence/'intent-reservation.json',{'invoice':'recovery-invoice-1','independentProcessExitCodes':dup_results,'meaning':'One durable SQLite reservation succeeded; the other process was refused before building.'})
            with (run/'runtime.json').open() as f: runtime=json.load(f)
            proxy,proxy_thread,proxy_url=lost_response_proxy(endpoint,signed[0]['transaction'])
            runtime['url']=proxy_url;write(run/'runtime.json',runtime)
            submitters=[subprocess.Popen(['node',str(HERE/'proof.mjs'),'race-submit',str(run),name,'on-rpc-error' if name=='race-alice' else 'no'],cwd=HERE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True) for name in ['race-alice','race-ben']]
            time.sleep(.5);(run/'race-release').write_text('release\n')
            submit_codes=[]
            for p in submitters:
                out,_=p.communicate(timeout=60);log.write(out);log.flush();print(out,flush=True)
                submit_codes.append(p.returncode)
            proxy.shutdown();proxy.server_close();proxy_thread.join(timeout=5)
            runtime['url']=endpoint;write(run/'runtime.json',runtime)
            assert submit_codes[0]==74 and submit_codes[1]==0, f'Expected dropped Alice response/process death and normal Ben receipt: {submit_codes}'
            write(evidence/'lost-rpc-response.json',{'transactionHash':signed[0]['hash'],'proxy':proxy.lost,'builderExitCode':submit_codes[0],'receiptPersisted':(run/'evidence'/'race-alice-submit.json').exists(),'recovery':'Fresh process queries exact pinned hash and all original input outpoints; no automatic rebuild.'})
            generated=[]
            for _ in range(20):
                generated.append(rpc(endpoint,'generate_block'))
                statuses=[rpc(endpoint,'get_transaction',[item['hash']]) for item in signed]
                if any(t and t.get('tx_status',{}).get('status')=='committed' for t in statuses): break
            final={name:rpc(endpoint,'get_transaction',[item['hash']]) for name,item in zip(['race-alice','race-ben'],signed)}
            loser='race-ben' if final['race-alice']['tx_status']['status']=='committed' else 'race-alice'
            command(['node',HERE/'proof.mjs','race-stale-resubmit',run,loser])
            for name in ['race-alice','race-ben']:
                command(['node',HERE/'proof.mjs','race-reconcile',run,name])
            for invoice in ['race-invoice-alice','race-invoice-ben']:
                command(['python',HERE/'payment_intents.py',journal,'reconcile',invoice,endpoint])
            state=rpc(endpoint,'get_live_cell',[{'tx_hash':signed[0]['transaction']['inputs'][0]['previous_output']['tx_hash'],'index':signed[0]['transaction']['inputs'][0]['previous_output']['index']},True])
            winner='race-alice' if final['race-alice']['tx_status']['status']=='committed' else 'race-ben'
            winner_signed=next(item for name,item in zip(['race-alice','race-ben'],signed) if name==winner)
            winner_role='alice' if winner.endswith('alice') else 'ben'
            invoice='race-invoice-'+winner_role
            duplicate=subprocess.run(['python',HERE/'payment_intents.py',journal,'reserve',invoice],cwd=HERE,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            assert duplicate.returncode==3,'Committed invoice was not durably reserved'
            log.write(duplicate.stdout);log.flush();print(duplicate.stdout,flush=True)
            context=json.loads((run/'context.json').read_text());context['policy']={'txHash':winner_signed['hash'],'index':0};context['fund']={'txHash':winner_signed['hash'],'index':1};context['seeds'][winner_role]={'txHash':winner_signed['hash'],'index':3};write(run/'context.json',context)
            command(['node',HERE/'proof.mjs','race-build',run,winner_role,'20','same-invoice-rebuild'])
            replay=json.loads((run/'same-invoice-rebuild-signed.json').read_text())
            command(['node',HERE/'proof.mjs','race-submit',run,'same-invoice-rebuild'])
            replay_status=None
            for _ in range(20):
                rpc(endpoint,'generate_block');replay_status=rpc(endpoint,'get_transaction',[replay['hash']])
                if replay_status and replay_status['tx_status']['status']=='committed':break
            assert replay_status and replay_status['tx_status']['status']=='committed','Intent-bypassing duplicate control did not commit'
            first_recipient=winner_signed['transaction']['outputs'][2]['lock']
            replay_recipient=replay['transaction']['outputs'][2]['lock']
            assert first_recipient==replay_recipient
            write(evidence/'invoice-replay-control.json',{'invoiceId':invoice,'firstPaymentHash':winner_signed['hash'],'recoveredState':'committed; durable journal refused reservation with exit 3','secondFreshTransactionHash':replay['hash'],'secondStatus':replay_status['tx_status']['status'],'sameRecipient':first_recipient,'meaning':'Q accepted a second payment to the same recipient from refreshed state when the local idempotency journal was deliberately bypassed. Invoice identifiers are not committed to the current ABI.'})
            responses={}
            for name in ['race-alice','race-ben']:
                receipt=run/'evidence'/(name+'-submit.json')
                responses[name]=(json.loads(receipt.read_text()) if receipt.exists() else {'txHash':next(x['hash'] for n,x in zip(['race-alice','race-ben'],signed) if n==name),'rpcResponse':'intentionally dropped by local proxy','receiptPersisted':False})
            write(evidence/'race-outcome.json',{'scenario':'two independent builders from identical policy and fund outpoints','transactions':{name:item['hash'] for name,item in zip(['race-alice','race-ben'],signed)},'submitResponses':responses,'transactionStatus':final,'generatedBlocks':generated,'predecessorPolicyLiveCell':state,'policyOutpoint':signed[0]['transaction']['inputs'][0]['previous_output'],'winner':winner,'conclusion':'Only node-reported statuses are claimed; invoice identity is not present in the ABI.'})
            write(evidence/'verdict.json',{'verdict':'RACE_RECORDED','startedUTC':started,'finishedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()})
            return
        command(['node',HERE/'proof.mjs','spend',run,'alice','60','accept','04-alice60'])
        write(evidence/'gate1.json',{'passed':True,'meaning':'Unchanged Q and exact dependencies on dev node; CCC-built and K-signed Alice60 committed'})
        command(['node',HERE/'proof.mjs','spend',run,'ben','50','shared-reject','05-ben50-rejected'])
        command(['node',HERE/'proof.mjs','spend',run,'ben','40','accept','06-ben40'])
        command(['node',HERE/'proof.mjs','finish',run])
        write(evidence/'verdict.json',{'verdict':'PASS','startedUTC':started,'finishedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat()})
    finally:
        process.terminate()
        try: process.wait(timeout=20)
        except subprocess.TimeoutExpired: process.kill();process.wait(timeout=10)
        stdout.close();stderr.close();log.close()
        shutil.copyfile(run/'execution.log',evidence/'execution.log')
        shutil.copyfile(run/'node.stderr.log',evidence/'node.stderr.log')
        shutil.copyfile(run/'node.stdout.log',evidence/'node.stdout.log')
        saved=HERE/'results'/run.name;saved.parent.mkdir(exist_ok=True)
        if opts.scenario=='wo12':
            saved.mkdir()
            selected=['environment.json','node-profile.json','01-authorized-v2-payment.json',
                '01-authorized-v2-state.json','01-reject-v2-over-limit-payment.json',
                '02-reject-wrong-terminal-owner.json','02-reject-forged-terminal-from-active.json',
                '02-owner-close-compact.json','03-compact-closed-live.json',
                '03-reject-reenable-after-close.json','04-late-deposit-after-close.json',
                '05-terminal-survives-late-deposit.json','06-reject-delegate-after-close.json',
                '07-owner-sweeps-late-deposit.json','08-final-capital-state.json',
                '09-reject-terminal-deletion.json','verdict.json']
            for name in selected: shutil.copyfile(evidence/name,saved/name)
        else: shutil.copytree(evidence,saved)
        print('Evidence saved:',saved,flush=True)
        print('Private disposable keys and chain data stay ignored in:',run,flush=True)

if __name__=='__main__': main()
