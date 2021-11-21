function(){try{let _interrupt=false;const _temp=_for(function(){return!_interrupt;},void 0,function(){console.log("loop");return Promise.resolve(null).then(function(){// important
_interrupt=true;});// important
});return Promise.resolve(_temp&&_temp.then?_temp.then(function(){}):void 0);}catch(e){return Promise.reject(e);}}