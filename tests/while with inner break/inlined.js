function(){try{let _interrupt=false;let result=0;const _temp3=_for(function(){return!_interrupt;},void 0,function(){function _temp2(){if(!_interrupt)result=2;}const _temp=_catch(function(){return Promise.resolve(null).then(function(){result=1;_interrupt=true;});},function(){});return _temp&&_temp.then?_temp.then(_temp2):_temp2(_temp);});return Promise.resolve(_temp3&&_temp3.then?_temp3.then(function(){return result;}):result);}catch(e){return Promise.reject(e);}}