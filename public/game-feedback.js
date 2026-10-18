window.HoopFeedback = {
  setFouls(element, count) {
    const fouls = Math.max(0, Math.min(3, Number(count) || 0));
    element.textContent = String(fouls);
    const meter = element.closest('.foul-meter');
    meter.dataset.fouls = String(fouls);
    meter.setAttribute('aria-label', `${fouls} of 3 fouls`);
    meter.querySelectorAll('.foul-pip').forEach((pip, index) => pip.classList.toggle('filled', index < fouls));
  }
};
