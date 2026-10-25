window.explorixShell.onStatus(({ message, detail }) => {
  document.getElementById('message').textContent = message;
  document.getElementById('detail').textContent = detail || '';
});
