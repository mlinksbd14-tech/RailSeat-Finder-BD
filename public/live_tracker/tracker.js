/**
 * Standalone Live Train Location Tracker Client
 * Powered by trainkothai.com & Bangladesh Railway TTMS
 * Isolated from main dashboard codebase
 */

document.addEventListener('DOMContentLoaded', () => {
  const trainMap = {
    '701': 'Subarna Express',
    '702': 'Subarna Express',
    '703': 'Mohanagar Godhuli',
    '704': 'Mohanagar Provati',
    '705': 'Ekota Express',
    '706': 'Ekota Express',
    '709': 'Parabat Express',
    '710': 'Parabat Express',
    '711': 'Upakul Express',
    '712': 'Upakul Express',
    '717': 'Jayantika Express',
    '718': 'Jayantika Express',
    '719': 'Paharika Express',
    '720': 'Paharika Express',
    '721': 'Mohanganj Express',
    '722': 'Mohanganj Express',
    '739': 'Upaban Express',
    '740': 'Upaban Express',
    '741': 'Turna Express',
    '742': 'Turna Express',
    '751': 'Lalmoni Express',
    '752': 'Lalmoni Express',
    '753': 'Silk City Express',
    '754': 'Silk City Express',
    '769': 'Dhumketu Express',
    '770': 'Dhumketu Express',
    '771': 'Rangpur Express',
    '772': 'Rangpur Express',
    '775': 'Sirajganj Express',
    '776': 'Sirajganj Express',
    '787': 'Sonar Bangla Express',
    '788': 'Sonar Bangla Express',
    '791': 'Banalata Express',
    '792': 'Banalata Express',
    '793': 'Panchagarh Express',
    '794': 'Panchagarh Express',
    '795': 'Benapole Express',
    '796': 'Benapole Express',
    '797': 'Kurigram Express',
    '798': 'Kurigram Express',
    '801': 'Chattala Express',
    '802': 'Chattala Express',
    '813': 'Cox\l\\\s Bazar Express',
    '814': 'Cox\l\\\s Bazar Express',
    '815': 'Parjotok Express',
    '816': 'Parjotok Express'
  };

  let currentModel = '702';
  let currentName = 'Subarna Express';

  const trackerIframe = document.getElementById('trackerIframe');
  const frameLoader = document.getElementById('frameLoader');
  const currentTrackingLabel = document.getElementById('currentTrackingLabel');
  const directTrackLink = document.getElementById('directTrackLink');
  const directExternalBtn = document.getElementById('directExternalBtn');
  const refreshFrameBtn = document.getElementById('refreshFrameBtn');
  const refreshFrameIcon = document.getElementById('refreshFrameIcon');
  const fullScreenBtn = document.getElementById('fullScreenBtn');
  const frameContainer = document.getElementById('frameContainer');
  const trainSearchForm = document.getElementById('trainSearchForm');
  const trainSearchInput = document.getElementById('trainSearchInput');
  const chipsContainer = document.getElementById('chipsContainer');
  const smsInfoSection = document.getElementById('smsInfoSection');

  const btnViewSpecific = document.getElementById('btnViewSpecific');
  const btnViewAll = document.getElementById('btnViewAll');
  const btnViewSMS = document.getElementById('btnViewSMS');

  // Check URL query param e.g. ?train=788 or ?model=814
  const urlParams = new URLSearchParams(window.location.search);
  const qTrain = urlParams.get('train') || urlParams.get('model');
  if (qTrain) {
    const matched = trainMap[qTrain] || qTrain;
    loadTrain(qTrain, matched);
  }

  // Handle Iframe Load complete
  if (trackerIframe) {
    trackerIframe.addEventListener('load', () => {
      if (frameLoader) frameLoader.classList.add('hidden');
    });
  }

  function loadTrain(model, name) {
    currentModel = model;
    currentName = name || trainMap[model] || ('Train #' + model);

    if (frameLoader) frameLoader.classList.remove('hidden');

    const targetUrl = 'https://trainkothai.com/track/' + encodeURIComponent(model);
    if (trakerIframe) trackerIframe.src = targetUrl;

    if (currentTrackingLabel) currentTrackingLabel.textContent = currentName + ' (#' + currentModel + ')';
    if (directTrackLink) directTrackLink.href = targetUrl;
    if (directExternalBtn) directExternalBtn.href = targetUrl;

    // Update active chip styling
    const chips = document.querySelectorAll('.train-chip');
    chips.forEach(chip => {
      if (chip.dataset.model === model) {
        chip.className = 'train-chip px-2.5 py-0.5 rounded-lg bg-emerald-950 text-emerald-300 border border-emerald-700/80 text-[11px] font-semibold transition shrink-0 active-chip';
      } else {
        chip.className = 'train-chip px-2.5 py-0.5 rounded-lg bg-slate-800 hover:bg-emerald-950 hover:text-emerald-300 hover:border-emerald-700/80 border border-slate-700 text-slate-300 text-[11px] font-semibold transition shrink-0';
      }
    });

    if (smsInfoSection) smsInfoSection.classList.add('hidden');
    if (frameContainer) frameContainer.classList.remove('hidden');
    setActiveModeButton(btnViewSpecific);
  }

  function setActiveModeButton(activeBtn) {
    [btnViewSpecific, btnViewAll, btnViewSMS].forEach(btn => {
      if (!btn) return;
      if (btn === activeBtn) {
        btn.className = 'px-2.5 py-1 rounded-lg font-bold bg-emerald-600 text-white transition';
      } else {
        btn.className = 'px-2.5 py-1 rounded-lg font-bold text-slate-400 hover:text-white transition';
      }
    });
  }

  // Quick Chips Click Delegation
  if (chipsContainer) {
    chipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.train-chip');
      if (chip && chip.dataset.model) {
        loadTrain(chip.dataset.model, chip.dataset.name);
      }
    });
  }

  // Search Form Submit Handler
  if (trainSearchForm) {
    trainSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = (trainSearchInput.value || '').trim();
      if (!q) return;

      // Check numeric model
      const numericMatch = q.match(/\d{2,4}/);
      if (numericMatch) {
        const model = numericMatch[0];
        loadTrain(model, trainMap[model] || ('Train #' + model));
        return;
      }

      // Search train name in trainMap
      const lowerQ = q.toLowerCase();
      const entry = Object.entries(trainMap).find([, n] => n.toLowerCase().includes(lowerQ));
      if (entry) {
        loadTrain(entry[0], entry[1]);
      } else {
        // Direct search view
        if (frameLoader) frameLoader.classList.remove('hidden');
        const searchUrl = 'https://trainkothai.com/search?q=' + encodeURIComponent(q);
        if (trackerIframe) trackerIframe.src = searchUrl;
        if (currentTrackingLabel) currentTrackingLabel.textContent = 'Search: ' + q;
        if (directTrackLink) directTrackLink.href = searchUrl;
      }
    });
  }

  // View Mode: Specific Train
  if (btnViewSpecific) {
    btnViewSpecific.addEventListener('click', () => {
      loadTrain(currentModel, currentName);
    });
  }

  // View Mode: All Trains
  if (btnViewAll) {
    btnViewAll.addEventListener('click', () => {
      setActiveModeButton(btnViewAll);
      if (smsInfoSection) smsInfoSection.classList.add('hidden');
      if (frameContainer) frameContainer.classList.remove('hidden');
      if (frameLoader) frameLoader.classList.remove('hidden');

      const allUrl = 'https://trainkothai.com/trains';
      if (trackerIframe) trackerIframe.src = allUrl;
      if (currentTrackingLabel) currentTrackingLabel.textContent = 'All Live Running Trains';
      if (directTrackLink) directTrackLink.href = allUrl;
    });
  }

  // View Mode: SMS
  if (btnViewSMS) {
    btnViewSMS.addEventListener('click', () => {
      setActiveModeButton(btnViewSMS);
      if (smsInfoSection) smsInfoSection.classList.remove('hidden');
      if (frameContainer) frameContainer.classList.add('hidden');
    });
  }

  // Refresh Frame Action
  if (refreshFrameBtn) {
    refreshFrameBtn.addEventListener('click', () => {
      if (refreshFrameIcon) refreshFrameIcon.classList.add('animate-spin');
      if (frameLoader) frameLoader.classList.remove('hidden');
      if (trackerIframe) {
        trackerIframe.src = trackerIframe.src;
      }
      setTimeout(() => {
        if (refreshFrameIcon) refreshFrameIcon.classList.remove('animate-spin');
      }, 1000);
    });
  }

  // Full Screen Toggle
  if (fullScreenBtn) {
    fullScreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        frameContainer.requestFullscreen().catch(err => console.warn(err));
      } else {
        document.exitFullscreen().catch(err => console.warn(err));
      }
    });
  }
});
