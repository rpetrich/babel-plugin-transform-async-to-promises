function(value){const add=function(l,r){return Promise.resolve(l).then(function(_l){return Promise.resolve(r).then(function(_r){return _l+_r;});});};return function(foo){return add(1,foo);};}