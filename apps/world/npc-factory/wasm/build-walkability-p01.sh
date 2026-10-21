#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${CXX:=clang++}"
# Use an explicit linker path when unpacked locally; never change system PATH.
if [ -n "${WASM_LD:-}" ]; then PATH="$(dirname "$WASM_LD"):$PATH"; export PATH; fi
"$CXX" --target=wasm32 -std=c++17 -O3 -ffp-contract=off -fno-fast-math \
  -fno-exceptions -fno-rtti -fno-builtin -nostdlib \
  -Wl,--no-entry -Wl,--export=classify -Wl,--export=abi_version \
  -Wl,--export=__heap_base -Wl,--export-memory -Wl,--strip-all \
  -Wl,--initial-memory=131072 -Wl,--max-memory=67108864 \
  -o walkability-p01.wasm walkability-p01.cpp
node --input-type=module -e 'import {readFileSync} from "node:fs"; const m=await WebAssembly.compile(readFileSync("walkability-p01.wasm")); if(WebAssembly.Module.imports(m).length)throw Error("unexpected runtime import"); const i=await WebAssembly.instantiate(m); if(i.exports.abi_version()!==1)throw Error("ABI"); console.log("freestanding walkability ABI 1, no imports");'
CXX="$CXX" node --input-type=module <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const files=Object.fromEntries(['walkability-p01.cpp','walkability-p01.wasm','build-walkability-p01.sh'].map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
const manifest={abi:1,runtimeImports:0,compiler:execFileSync(process.env.CXX,['--version'],{encoding:'utf8'}).split('\n')[0],target:'wasm32',floatingPoint:'f64, no fast-math, no contraction',files};
writeFileSync('walkability-p01.build.json',JSON.stringify(manifest,null,2)+'\n');
JS
