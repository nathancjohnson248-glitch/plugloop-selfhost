/**
 * /js/script.js: the hosted tracker (public/js/script.js in the main repo) in its cookieless mode,
 * always. No cookies, no localStorage: a random session id lives in sessionStorage (gone when the
 * tab closes) and the server derives a daily visitor hash. Same wire format as hosted, so the same
 * checkout-link tagging (Stripe, Lemon Squeezy, Dodo, Polar) and `plugloop()` API work.
 *
 * Install: <script defer data-site="KEY" src="https://YOUR-WORKER/js/script.js"></script>
 */
export const TRACKER = `"use strict";(function(w,d){var el=d.currentScript;if(!el)return;
var key=el.getAttribute("data-site"),api=el.getAttribute("data-api")||new URL(el.src).origin+"/api/collect",loc=w.location;
if(!key||w.navigator.webdriver||(/^(localhost|127\\.|\\[::1\\])/.test(loc.hostname)&&!el.hasAttribute("data-allow-localhost"))||loc.protocol==="file:")return;
function rid(){var c=w.crypto;return(c&&c.randomUUID?c.randomUUID().replace(/-/g,""):Math.random().toString(36).slice(2)+Date.now().toString(36)+Math.random().toString(36).slice(2)).slice(0,22)}
var store={};try{store=w.sessionStorage||{}}catch(e){}
var sid;function session(){try{sid=store._pl_s||rid();store._pl_s=sid}catch(e){sid=sid||rid()}return sid}session();
function send(type,extra){session();var q=new URLSearchParams(loc.search),ref=d.referrer,b={k:key,t:type,p:loc.pathname,s:sid,w:w.innerWidth};
if(ref&&ref.indexOf(loc.origin)!==0)b.r=ref;
["source","medium","campaign","term","content"].forEach(function(n){var v=q.get("utm_"+n)||(n=="source"&&q.get("ref"));if(v)b[n]=v});
for(var k in extra)b[k]=extra[k];var body=JSON.stringify(b);
if(!(w.navigator.sendBeacon&&w.navigator.sendBeacon(api,body)))fetch(api,{method:"POST",body:body,keepalive:true})}
var last;function view(){if(loc.pathname!==last){last=loc.pathname;send("pageview")}}
var h=w.history;["pushState","replaceState"].forEach(function(m){var o=h[m];h[m]=function(){var r=o.apply(this,arguments);view();return r}});w.addEventListener("popstate",view);
function meta(){return{plugloop_visitor_id:sid,plugloop_session_id:sid}}
d.addEventListener("click",function(ev){var a=ev.target.closest&&ev.target.closest("a[href]");if(!a)return;try{var u=new URL(a.href),host=u.hostname,p=u.searchParams;
if(/(^|\\.)buy\\.stripe\\.com$/.test(host))p.set("client_reference_id",sid+"_"+sid);
else if(/lemonsqueezy\\.com$/.test(host)){p.set("checkout[custom][plugloop_visitor_id]",sid);p.set("checkout[custom][plugloop_session_id]",sid)}
else if(/(^|\\.)checkout\\.dodopayments\\.com$/.test(host)){p.set("metadata_plugloop_visitor_id",sid);p.set("metadata_plugloop_session_id",sid)}
else if(/(^|\\.)(buy\\.)?polar\\.sh$/.test(host)&&/checkout/.test(u.pathname)){p.set("customer_metadata[plugloop_visitor_id]",sid);p.set("customer_metadata[plugloop_session_id]",sid)}
else return;a.href=u.toString();send("checkout_started")}catch(e){}},true);
var pl=function(kind,a,b){if(kind=="goal"||kind=="track")send("custom",{n:String(a).slice(0,60),m:b});else if(kind=="checkout")send("checkout_started",a&&a.amount?{a:Math.round(a.amount*100)}:{})};
pl.ids=function(){return{visitorId:sid,sessionId:sid}};pl.visitorId=pl.sessionId=function(){return sid};
pl.track=pl.goal=function(n,m){pl("goal",n,m)};pl.checkout=function(o){pl("checkout",o)};pl.metadata=meta;
var queued=w.plugloop&&w.plugloop.q;w.plugloop=pl;if(queued)for(var i=0;i<queued.length;i++)pl.apply(null,queued[i]);view()})(window,document);
`;
