const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const {join}=require('node:path');
const directory=mkdtempSync(join(tmpdir(),'cortisol-tests-'));process.env.CORTISOL_DATA_DIR=directory;
process.on('exit',()=>{try{rmSync(directory,{recursive:true,force:true});}catch{}});
