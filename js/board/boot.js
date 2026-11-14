// If the page's program has not started a moment after the page loaded, say why.
// The usual reason is an empty vexo-open-kit folder: the kit comes as a git
// submodule. (Opened by double-click instead? The kit's own note says so.)
setTimeout(() => {
  if (document.body.dataset.ready || location.protocol === 'file:') return;
  document.getElementById('no-kit').hidden = false;
}, 2500);
