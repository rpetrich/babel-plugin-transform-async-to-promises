_async(function(){let _interrupt;function _temp(){// important
_interrupt=1;}return _continueIgnored(_for(function(){return!_interrupt;},void 0,function(){console.log("loop");return _await(null,_temp);// important
}));})