(function(){
  function add(){
    var f=document.querySelector('footer');
    if(!f||f.querySelector('a[data-privacy]'))return;
    var a=document.createElement('a');
    a.href='/coachkonnekt/privacy';a.textContent='Privacy policy';a.setAttribute('data-privacy','');
    a.style.cssText='color:inherit;text-decoration:underline;text-underline-offset:3px';
    f.appendChild(document.createTextNode(' \u00b7 '));f.appendChild(a);
  }
  new MutationObserver(add).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',add);
})();
