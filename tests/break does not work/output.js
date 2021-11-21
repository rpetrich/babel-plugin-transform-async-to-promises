_async(()=>{let _interrupt=false;return _continueIgnored(_for(()=>!_interrupt,void 0,()=>{console.log("loop");return _await(null,()=>{// important
_interrupt=true;});// important
}));})