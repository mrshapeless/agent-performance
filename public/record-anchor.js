(()=>{const reveal=()=>{if(location.hash.startsWith('#record'))document.querySelector('.process-record')?.setAttribute('open','');};reveal();addEventListener('hashchange',reveal);})();
