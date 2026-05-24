const LIBRARY_SECTIONS = [
  {
    id: 'airframe',
    title: 'Cessna 152 Airframe',
    icon: '&#9992;',
    docs: [
      { title: 'Cessna 152 Maintenance Manual', desc: 'Airframe maintenance procedures & schedules', file: 'manuals/c152-maintenance-manual.pdf' },
      { title: 'Cessna 152 Illustrated Parts Catalog (IPC)', desc: 'Airframe part numbers & exploded views', file: 'manuals/c152-ipc.pdf' },
      { title: 'Cessna 152 Service Manual', desc: 'Repair & alteration instructions', file: 'manuals/c152-service-manual.pdf' }
    ]
  },
  {
    id: 'engine',
    title: 'Lycoming O-235 (L-20350-15)',
    icon: '&#9881;',
    docs: [
      { title: 'Lycoming O-235 Operator\'s Manual', desc: 'Operation, limitations & servicing', file: 'manuals/o235-operators-manual.pdf' },
      { title: 'Lycoming O-235 Overhaul Manual', desc: 'L-20350-15 — Major overhaul procedures, limits & tolerances', file: 'manuals/o235-overhaul-manual.pdf' },
      { title: 'Lycoming O-235 Parts Catalog (IPC)', desc: 'Engine exploded views & part numbers', file: 'manuals/o235-ipc.pdf' },
      { title: 'Lycoming O-235 Service Bulletins', desc: 'Applicable SBs & SI for L-20350-15', file: 'manuals/o235-service-bulletins.pdf' }
    ]
  },
  {
    id: 'propeller',
    title: 'Propeller & Accessories',
    icon: '&#9881;',
    docs: [
      { title: 'Propeller Owner\'s Manual', desc: 'McCauley or Sensenich for C152', file: 'manuals/propeller-manual.pdf' },
      { title: 'Propeller IPC', desc: 'Propeller component parts breakdown', file: 'manuals/propeller-ipc.pdf' }
    ]
  }
];

function libraryView() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="page">
      <div class="page-header">
        <h2>Library</h2>
        <div class="subtitle">Technical manuals &amp; references</div>
      </div>
      <div id="library-content"></div>
    </div>
  `;
  renderLibrary();
}

function openDoc(file) {
  window.open(file, '_blank');
}

function renderLibrary() {
  const el = document.getElementById('library-content');
  el.innerHTML = LIBRARY_SECTIONS.map(section => `
    <div class="card" style="margin-bottom:14px">
      <div class="card-header" style="cursor:pointer" data-toggle="lib-${section.id}">
        <h3>${section.icon} ${section.title}</h3>
        <span class="lib-toggle">&#9660;</span>
      </div>
      <div id="lib-${section.id}" style="display:block">
        ${section.docs.map(doc => `
          <div class="lib-doc-item" data-file="${doc.file}" style="cursor:pointer">
            <div class="lib-doc-icon">&#128196;</div>
            <div class="lib-doc-info">
              <div class="lib-doc-title">${doc.title}</div>
              <div class="lib-doc-desc">${doc.desc}</div>
            </div>
            <div class="lib-doc-open">&#8599;</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.lib-doc-item').forEach(item => {
    item.addEventListener('click', () => {
      const file = item.dataset.file;
      openDoc(file);
    });
  });

  el.querySelectorAll('.card-header[data-toggle]').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.lib-doc-item')) return;
      const target = document.getElementById(header.dataset.toggle);
      const toggle = header.querySelector('.lib-toggle');
      if (target.style.display === 'none') {
        target.style.display = 'block';
        if (toggle) toggle.style.transform = 'rotate(0deg)';
      } else {
        target.style.display = 'none';
        if (toggle) toggle.style.transform = 'rotate(-90deg)';
      }
    });
  });
}
