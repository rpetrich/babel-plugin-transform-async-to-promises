function(foo){try{return Promise.resolve(_catch(foo,function(){}));}catch(e){return Promise.reject(e);}}