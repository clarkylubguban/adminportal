const POS_URL = "https://trry-pos.vercel.app";

function wireOverviewPosLinks() {
  const page = document.querySelector('.mvp-overview-page[data-overview-v2-mounted="true"]');
  if (!page) return;

  const openPos = page.querySelector('.ov2-open-pos');
  if (openPos) {
    openPos.setAttribute('href', POS_URL);
    openPos.setAttribute('target', '_blank');
    openPos.setAttribute('rel', 'noreferrer');
  }

  [...page.querySelectorAll('.ov2-action')]
    .filter((link) => link.textContent?.trim() === '+ SALE')
    .forEach((link) => {
      link.setAttribute('href', POS_URL);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noreferrer');
    });
}

const observer = new MutationObserver(wireOverviewPosLinks);

function start() {
  wireOverviewPosLinks();
  const root = document.getElementById('root');
  if (root) observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
