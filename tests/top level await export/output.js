System.register([],function(_export,_context){"use strict";var head,response,body,json,tail;return{setters:[],execute:_async(()=>{_export("head",head=1);return _await(fetch("https://www.example.com/"),_fetch=>{response=_fetch;_export("body",body=2);return _await(response.json(),_response$json=>{json=_response$json;_export("tail",tail=json);});});})};});