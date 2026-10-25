(function(){
  function add(){
    var f=document.querySelector('footer');
    if(!f||f.querySelector('a[data-privacy]'))return;
    function link(href,text,attr){var a=document.createElement('a');a.href=href;a.textContent=text;a.setAttribute(attr,'');
      a.style.cssText='color:inherit;text-decoration:underline;text-underline-offset:3px';f.appendChild(document.createTextNode(' \u00b7 '));f.appendChild(a);}
    link('/coachkonnekt/privacy','Privacy policy','data-privacy');
    link('/coachkonnekt/dashboard/','Coach login','data-login');
  }
  new MutationObserver(add).observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',add);
})();
