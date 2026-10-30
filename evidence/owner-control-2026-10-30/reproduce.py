"""WO10 additive isolated-node owner proof. Does not change original scripts."""
from pathlib import Path
import argparse,hashlib,json,subprocess,sys

HERE=Path(__file__).resolve().parent
def main():
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--run-dir',type=Path);p.add_argument('--ckb',type=Path)
 a=p.parse_args();repo=a.repo.resolve();example=repo/'examples/local-chain'
 pins={'examples/local-chain/proof.mjs':'07d9439f1574a171f1649146dd7949ec7319d14c7fdb633a376a0ed9bb76b6c7',
 'examples/local-chain/reproduce.py':'060e4fd54744b1a83f68a954ac2479e157f0ea4315dbb8fa8a77fc96111b05d3',
 'policy/c/allowance.c':'a9e1fb941bb85f4bdb3c6090c60388be685b0a6321fd4972858aab04595dcf21',
 'policy/c/profile.h':'62a527839eac0bd0a8379f60adfe8cc9be295f8ed79b84d42f9ce2993b66350d'}
 for name,digest in pins.items():assert hashlib.sha256((repo/name).read_bytes()).hexdigest()==digest,name
 expected='e3774c9b295e71ea4b2990cd61fb445647992e0f21e4f2bc0432d0278241e406'
 assert hashlib.sha256((repo/'policy/build/allowance').read_bytes()).hexdigest()==expected
 source=(example/'proof.mjs').read_text(encoding='utf-8')
 prefix=source[:source.rindex('await fs.mkdir(result,{recursive:true});')]
 prefix=prefix.replace("import * as c from '@ckb-ccc/core';",'import * as c from '+json.dumps((example/'node_modules/@ckb-ccc/core/dist/index.mjs').as_uri())+';')
 prefix=prefix.replace('const here=path.dirname(fileURLToPath(import.meta.url));','const here='+json.dumps(example.as_posix())+';')
 generated=HERE/'.local';generated.mkdir(exist_ok=True)
 module=generated/'owner-generated.mjs';module.write_text(prefix+(HERE/'owner_actions.mjs').read_text(encoding='utf-8'),encoding='utf-8')
 subprocess.run(['node','--check',str(module)],check=True)
 runner=(example/'reproduce.py').read_text(encoding='utf-8')
 runner=runner.replace('HERE=Path(__file__).resolve().parent','HERE=Path('+repr(str(example))+')')
 runner=runner.replace("HERE/'proof.mjs'",'Path('+repr(str(module))+')')
 start=runner.index("        command(['node',Path(",runner.index("rpc(endpoint,'set_network_active',[False])"))
 end=runner.index("        write(evidence/'verdict.json'",start)
 runner=runner[:start]+f"        command(['node',Path({str(module)!r}),'setup',run])\n        command(['node',Path({str(module)!r}),'owner-proof',run])\n"+runner[end:]
 script=generated/'runner-generated.py';script.write_text(runner,encoding='utf-8')
 args=[sys.executable,'-u','-B',str(script),'--run-dir',str((a.run_dir or generated/'run').resolve())]
 if a.ckb:args.extend(['--ckb',str(a.ckb.resolve())])
 result=subprocess.run(args);raise SystemExit(result.returncode)
if __name__=='__main__':main()
