"""WO-07 disposable Windows dev chain. Never connects to a public CKB node."""
from pathlib import Path
import argparse, datetime, hashlib, json, os, re, shutil, socket, subprocess
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
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--ckb',type=Path);ap.add_argument('--run-dir',type=Path)
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
        with zipfile.ZipFile(archive) as z:
            for n in z.namelist(): assert (cache/n).resolve().is_relative_to(cache.resolve())
            z.extractall(cache)
        found=list(cache.rglob('ckb.exe'));assert len(found)==1;exe=found[0]
    assert sha(exe)=='77ff953e9dc3a03b36e38a3cab2b9b06f17be8254a15a23afa826c2d4aea98b0','Unexpected CKB executable bytes'
    run=(opts.run_dir or HERE/'.local'/datetime.datetime.now().strftime('run-%Y%m%d-%H%M%S')).resolve()
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
    command(['node',HERE/'proof.mjs','keys',run])
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
        command(['node',HERE/'proof.mjs','setup',run])
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
        shutil.copytree(evidence,saved)
        print('Evidence saved:',saved,flush=True)
        print('Private disposable keys and chain data stay ignored in:',run,flush=True)

if __name__=='__main__': main()
