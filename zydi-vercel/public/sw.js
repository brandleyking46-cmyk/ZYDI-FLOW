const CACHE='zydi-v5';
const STATIC=['/','/index.html','/manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(url.pathname.startsWith('/api/')){e.respondWith(fetch(e.request).catch(()=>new Response(JSON.stringify({error:'offline'}),{headers:{'Content-Type':'application/json'}})));}
  else if(e.request.mode==='navigate'||url.pathname==='/'||url.pathname==='/index.html'){
    // Network-first for the app shell itself, so deployed fixes are picked up
    // immediately on next load when online. Falls back to cache only when offline.
    e.respondWith(
      fetch(e.request).then(r=>{
        if(r.ok) caches.open(CACHE).then(ca=>ca.put(e.request,r.clone()));
        return r;
      }).catch(()=>caches.match(e.request))
    );
  }
  else{e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(ca=>ca.put(e.request,r.clone()));return r;})));}
});
self.addEventListener('push',e=>{
  if(!e.data)return;
  const d=e.data.json();
  e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:d.icon||'/icon-192.png',data:{url:d.url||'/'},vibrate:[100,50,100]}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=e.notification.data?.url||'/';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if(c.url.includes(self.location.origin)&&'focus' in c){c.navigate(url);return c.focus();}}if(clients.openWindow)return clients.openWindow(url);}));
});
