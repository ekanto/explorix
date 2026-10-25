const LABELS = {
  retry: ['Try again', 'Restart Explorix and try again'],
  'skip-backup': ['Upgrade without backup', 'Continue the database upgrade without a safety backup'],
  restore: ['Restore from backup…', 'Replace the current data with an Explorix backup file'],
  reset: ['Start with an empty workspace…', 'Move the current data aside (it is kept) and start fresh'],
  'open-logs': ['Open logs folder', ''],
  'open-data': ['Open data folder', ''],
  quit: ['Quit', ''],
};
(async () => {
  const p = await window.explorixShell.problem();
  if (!p) return;
  document.getElementById('title').textContent = p.title;
  document.getElementById('message').textContent = p.message;
  document.getElementById('detail').textContent = `Error code: ${p.code}\n\n${p.detail || '(no further details)'}`;
  document.getElementById('logs').textContent = p.logsDir;
  document.getElementById('version').textContent = `Explorix ${p.version} · data folder ${p.dataDir}`;
  const box = document.getElementById('actions');
  p.actions.forEach((name, i) => {
    const [label, title] = LABELS[name] || [name, ''];
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    if (i === 0) b.className = 'primary';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await window.explorixShell.action(name); } finally { b.disabled = false; }
    });
    box.appendChild(b);
  });
  box.querySelector('button')?.focus();
})();
