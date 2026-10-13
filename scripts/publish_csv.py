"""Copy the four existing CSV logs atomically into a served data directory."""
import argparse, os, shutil, tempfile
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--destination', required=True, type=Path)
args=parser.parse_args()
files=['user_disk_usage.csv','user_quotas.csv','disk_summary.csv','memory_summary.csv']
for name in files:
    if not (args.source/name).is_file(): parser.error(f'Arquivo ausente: {args.source/name}')
args.destination.mkdir(parents=True,exist_ok=True)
for name in files:
    fd,tmp=tempfile.mkstemp(dir=args.destination,prefix='.'+name)
    try:
        with os.fdopen(fd,'wb') as out, (args.source/name).open('rb') as inp: shutil.copyfileobj(inp,out)
        os.chmod(tmp,0o644)
        os.replace(tmp,args.destination/name)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
print('Quatro CSVs publicados.')
