function(foo){try{let _exit=false,_outerInterrupt=false;return Promise.resolve(foo()).then(function(_foo){if(_foo){_outerInterrupt=true;}}).then(function(){if(!_outerInterrupt){_exit=true;return false;}}).then(function(_result){return _exit?_result:true;});}catch(e){return Promise.reject(e);}}