"""Append campus activity presets without re-exporting skeleton geometry."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'addon'/'inha_npc_generator'))
from activity import *  # compatibility with inspection tools; Blender is not required here
if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('kind',choices=ACTIVITIES)
 p.add_argument('input',type=Path);p.add_argument('reference',type=Path);p.add_argument('output',type=Path)
 a=p.parse_args()
 if a.input.resolve()==a.output.resolve():p.error('Use a different output path.')
 run(a.input,a.reference if a.kind=='seat' else None,a.output,a.kind)
