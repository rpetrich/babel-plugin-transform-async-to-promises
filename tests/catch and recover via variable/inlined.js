function(value,log){try{function _temp2(){log("result:",result);return result;}var result;const _temp=_catch(function(){return Promise.resolve(value()).then(function(_value){result=_value;});},function(){result="an error";});return Promise.resolve(_temp&&_temp.then?_temp.then(_temp2):_temp2(_temp));}catch(e){return Promise.reject(e);}}