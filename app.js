// Data
let parts = [];
let usageLogs = [];
let nextPartId = 1;
let nextLogId = 1;

let allState = { page: 1, rows: 50, search: '' };
let needState = { page: 1, search: '' };
let criticalState = { page: 1, search: '' };
let logsSearch = '';
let currentEditPartId = null;
let currentEditLogId = null;
let selectedPartId = null;
let currentDetailsPartId = null;
let pendingDeletePartId = null;
let pendingDeleteLogId = null;
let pendingPhotoDeletePartId = null;
let html5QrCode = null;
let isScannerActive = false;

// Camera variables
let cameraStream = null;
let pendingPhotoPartId = null;
let reopenEditAfterPhoto = false;

function showToast(msg, isErr) {
  let t = document.createElement('div');
  t.className = 'success-toast';
  if (isErr) t.style.background = '#e76f51';
  t.innerHTML =
    '<i class="fas ' +
    (isErr ? 'fa-exclamation-triangle' : 'fa-check-circle') +
    '"></i> ' +
    msg;
  document.body.appendChild(t);
  setTimeout(function () {
    if (t) t.remove();
  }, 2500);
}

function saveData() {
  localStorage.setItem(
    'inventoryData',
    JSON.stringify({
      parts: parts,
      usageLogs: usageLogs,
      nextPartId: nextPartId,
      nextLogId: nextLogId,
    }),
  );
}

function loadData() {
  let saved = localStorage.getItem('inventoryData');
  if (saved) {
    try {
      let d = JSON.parse(saved);
      parts = d.parts || [];
      usageLogs = d.usageLogs || [];
      nextPartId = d.nextPartId || 1;
      nextLogId = d.nextLogId || 1;
    } catch (e) {}
  }
}

function hideModal(id) {
  let el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function showModal(id) {
  let el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>]/g, function (m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// Camera Functions
async function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(function (track) {
      track.stop();
    });
    cameraStream = null;
  }
  let video = document.getElementById('camera-video');
  if (video) video.srcObject = null;
}

async function startCamera() {
  await stopCamera();
  let video = document.getElementById('camera-video');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    video.srcObject = cameraStream;
  } catch (err) {
    showToast('Camera error: ' + err.message, true);
  }
}

async function openCameraForEdit(partId) {
  pendingPhotoPartId = partId;
  reopenEditAfterPhoto = true;
  hideModal('editModal');
  await startCamera();
  showModal('cameraModal');
}

async function closeCamera() {
  await stopCamera();
  hideModal('cameraModal');
  if (reopenEditAfterPhoto && pendingPhotoPartId) {
    openEditPart(pendingPhotoPartId);
    reopenEditAfterPhoto = false;
  }
  pendingPhotoPartId = null;
}

function capturePhoto() {
  let video = document.getElementById('camera-video');
  let canvas = document.getElementById('camera-canvas');
  let context = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  let photoData = canvas.toDataURL('image/jpeg', 0.8);
  if (pendingPhotoPartId) {
    let part = parts.find(function (p) {
      return p.id === pendingPhotoPartId;
    });
    if (part) {
      part.photo = photoData;
      saveData();
      showToast('✓ Photo captured and saved');
    }
  }
  closeCamera();
}

// Photo display
function displayPartPhotoInDetails(part) {
  let photoDisplay = document.getElementById('photoDisplay');
  if (part.photo && part.photo.indexOf('data:image') === 0) {
    photoDisplay.innerHTML =
      '<img src="' + part.photo + '" class="part-photo" alt="Part photo">';
  } else {
    photoDisplay.innerHTML =
      '<div class="part-photo-placeholder"><i class="fas fa-camera fa-2x"></i><span>No photo</span></div>';
  }
}

function displayPartPhotoInEdit(part) {
  let photoDisplay = document.getElementById('editPhotoDisplay');
  let removeBtn = document.getElementById('editRemovePhotoBtn');
  if (part.photo && part.photo.indexOf('data:image') === 0) {
    photoDisplay.innerHTML =
      '<img src="' + part.photo + '" class="part-photo" alt="Part photo">';
    if (removeBtn) removeBtn.style.display = 'inline-flex';
  } else {
    photoDisplay.innerHTML =
      '<div class="part-photo-placeholder"><i class="fas fa-camera fa-2x"></i><span>No photo</span></div>';
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

function handleRemovePhotoInEdit(partId) {
  pendingPhotoDeletePartId = partId;
  document.getElementById('confirmTitle').innerHTML =
    '<i class="fas fa-trash-alt"></i> Remove Photo';
  document.getElementById('confirmMessage').innerHTML =
    'Are you sure you want to remove this photo?';
  document.getElementById('confirmDetails').style.display = 'block';
  let part = parts.find(function (p) {
    return p.id === partId;
  });
  document.getElementById('confirmDetails').innerHTML =
    '<strong>Part:</strong> ' +
    escapeHtml(part.partNumber) +
    '<br><strong>Description:</strong> ' +
    escapeHtml(part.description);
  showModal('confirmDeleteModal');
}

function executePhotoDelete() {
  if (pendingPhotoDeletePartId) {
    let part = parts.find(function (p) {
      return p.id === pendingPhotoDeletePartId;
    });
    if (part) {
      delete part.photo;
      saveData();
      displayPartPhotoInEdit(part);
      showToast('✓ Photo removed');
    }
    pendingPhotoDeletePartId = null;
  }
  hideModal('confirmDeleteModal');
}

// QR Scanner Functions
async function stopQrScanner() {
  if (html5QrCode && isScannerActive) {
    try {
      await html5QrCode.stop();
    } catch (e) {}
    try {
      await html5QrCode.clear();
    } catch (e) {}
    isScannerActive = false;
  }
  html5QrCode = null;
}

async function startQrScanner() {
  if (!document.getElementById('qr-reader')) return;
  await stopQrScanner();
  let statusDiv = document.getElementById('qr-status');
  statusDiv.innerHTML =
    '<i class="fas fa-spinner fa-pulse"></i> Starting camera...';
  html5QrCode = new Html5Qrcode('qr-reader');
  try {
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
      function (decodedText) {
        onQrCodeSuccess(decodedText);
      },
      function (err) {},
    );
    isScannerActive = true;
    statusDiv.innerHTML =
      '<i class="fas fa-camera"></i> Position QR code in frame';
  } catch (err) {
    statusDiv.innerHTML =
      '<i class="fas fa-exclamation-triangle"></i> Camera error';
  }
}

async function onQrCodeSuccess(text) {
  await stopQrScanner();
  hideModal('qrScannerModal');
  findPartByQrCode(text);
}

async function openQrScanner() {
  await stopQrScanner();
  document.getElementById('manualQrInput').value = '';
  document.getElementById('qr-status').innerHTML =
    '<i class="fas fa-camera"></i> Initializing...';
  showModal('qrScannerModal');
  setTimeout(function () {
    startQrScanner();
  }, 300);
}

async function closeQrScanner() {
  await stopQrScanner();
  hideModal('qrScannerModal');
}

function findPartByQrCode(val) {
  let found = parts.find(function (p) {
    return p.partNumber.toLowerCase() === val.toLowerCase();
  });
  if (found) {
    showToast('✓ Found: ' + found.partNumber);
    showPartDetails(found.id);
  } else {
    if (confirm('Part "' + val + '" not found. Create new?')) {
      document.getElementById('newPartNumber').value = val;
      document.getElementById('newDescription').value = '';
      document.getElementById('newLocation').value = '';
      document.getElementById('newQuantity').value = 0;
      showModal('addPartModal');
    } else {
      showToast('Part not found', true);
    }
  }
}

function manualQrLookup() {
  let val = document.getElementById('manualQrInput').value.trim();
  if (!val) {
    showToast('Enter part number', true);
    return;
  }
  closeQrScanner();
  findPartByQrCode(val);
}

// Core Functions
function showPartDetails(id) {
  let p = parts.find(function (x) {
    return x.id === id;
  });
  if (!p) return;
  currentDetailsPartId = id;
  let need = p.currentQty < p.baselineQty;
  let crit = p.currentQty < p.baselineQty * 0.5;
  let statusText = need ? (crit ? 'CRITICAL' : 'Order Needed') : 'OK';
  let statusClass = need
    ? crit
      ? 'status-critical'
      : 'status-warning'
    : 'status-ok';
  let percent = Math.round((p.currentQty / p.baselineQty) * 100);
  let locHtml = p.location
    ? '<div class="details-row"><div class="details-label"><i class="fas fa-map-marker-alt"></i> Location</div><div class="details-value"><span class="location-badge">' +
      escapeHtml(p.location) +
      '</span></div></div>'
    : '<div class="details-row"><div class="details-label"><i class="fas fa-map-marker-alt"></i> Location</div><div class="details-value"><span style="color:#94a3b8;">Not specified</span></div></div>';
  let html =
    '<div class="details-row"><div class="details-label">Part Number</div><div class="details-value"><strong>' +
    escapeHtml(p.partNumber) +
    '</strong></div></div>' +
    '<div class="details-row"><div class="details-label">Description</div><div class="details-value">' +
    escapeHtml(p.description) +
    '</div></div>' +
    locHtml +
    '<div class="details-row"><div class="details-label">Current Quantity</div><div class="details-value"><span class="current-qty-display">' +
    p.currentQty +
    '</span></div></div>' +
    '<div class="details-row"><div class="details-label">Baseline</div><div class="details-value">' +
    p.baselineQty +
    '</div></div>' +
    '<div class="details-row"><div class="details-label">Stock Level</div><div class="details-value">' +
    percent +
    '% of baseline</div></div>' +
    '<div class="details-row"><div class="details-label">Status</div><div class="details-value"><span class="status-badge ' +
    statusClass +
    '">' +
    statusText +
    '</span></div></div>' +
    (need
      ? '<div class="details-row"><div class="details-label">Shortage</div><div class="details-value" style="color: #e76f51; font-weight: 600;">' +
        (p.baselineQty - p.currentQty) +
        ' units needed</div></div>'
      : '');
  document.getElementById('partDetailsContent').innerHTML = html;
  displayPartPhotoInDetails(p);
  showModal('partDetailsModal');
}

function editFromDetails() {
  if (currentDetailsPartId) {
    hideModal('partDetailsModal');
    openEditPart(currentDetailsPartId);
  }
}

function logFromDetails() {
  if (currentDetailsPartId) {
    hideModal('partDetailsModal');
    openQuickLog(currentDetailsPartId);
  }
}

function logUsage(partId, qty, note) {
  let part = parts.find(function (p) {
    return p.id === partId;
  });
  if (!part) return false;
  if (qty <= 0 || part.currentQty < qty) {
    showToast('Invalid quantity or insufficient stock', true);
    return false;
  }
  let prev = part.currentQty;
  part.currentQty -= qty;
  usageLogs.unshift({
    id: nextLogId++,
    partId: part.id,
    partNumber: part.partNumber,
    qtyUsed: qty,
    date: new Date().toLocaleString(),
    note: note || '',
    previousStock: prev,
    newStock: part.currentQty,
  });
  saveData();
  refreshAll();
  showToast(
    '✓ Used ' +
      qty +
      ' x ' +
      part.partNumber +
      ', remaining: ' +
      part.currentQty,
  );
  return true;
}

function renderAllParts() {
  let filtered = parts;
  if (allState.search && allState.search.length > 0) {
    filtered = parts.filter(function (p) {
      return (
        p.partNumber.toLowerCase().indexOf(allState.search) !== -1 ||
        p.description.toLowerCase().indexOf(allState.search) !== -1
      );
    });
  }
  let totalPages = Math.ceil(filtered.length / allState.rows) || 1;
  if (allState.page > totalPages) allState.page = 1;
  let pageItems = filtered.slice(
    (allState.page - 1) * allState.rows,
    allState.page * allState.rows,
  );
  let tbody = document.getElementById('allPartsBody');
  if (!tbody) return;
  if (pageItems.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;padding:30px;">No parts found<\/td><\/tr>';
  } else {
    tbody.innerHTML = '';
    for (let i = 0; i < pageItems.length; i++) {
      let p = pageItems[i];
      let need = p.currentQty < p.baselineQty;
      let crit = p.currentQty < p.baselineQty * 0.5;
      let row = tbody.insertRow();
      if (need) row.className = crit ? 'stock-critical' : 'stock-low';
      row.insertCell(0).innerHTML =
        '<span class="clickable-part" onclick="showPartDetails(' +
        p.id +
        ')"><strong>' +
        escapeHtml(p.partNumber) +
        '</strong></span>';
      row.insertCell(1).innerHTML = escapeHtml(p.description).substring(0, 50);
      row.insertCell(2).innerHTML =
        '<span class="current-qty-display">' + p.currentQty + '</span>';
      row.insertCell(3).innerHTML = p.baselineQty;
      let statusHtml = need
        ? crit
          ? '<span class="status-badge status-critical">CRITICAL</span>'
          : '<span class="status-badge status-warning">Order needed</span>'
        : '<span class="status-badge status-ok">OK</span>';
      row.insertCell(4).innerHTML = statusHtml;
    }
  }
  let container = document.getElementById('allPagination');
  if (container) {
    container.innerHTML = renderPagination(
      allState.page,
      totalPages,
      'changeAllPage',
    );
  }
  document.getElementById('totalPartsStat').innerHTML = parts.length;
  document.getElementById('lowStockStat').innerHTML = parts.filter(
    function (p) {
      return p.currentQty < p.baselineQty;
    },
  ).length;
}

function renderPagination(page, total, func) {
  if (total <= 1) return '';
  let html =
    '<button class="page-btn" onclick="' +
    func +
    '(' +
    Math.max(1, page - 1) +
    ')">◀</button>';
  for (let i = Math.max(1, page - 2); i <= Math.min(total, page + 2); i++) {
    html +=
      '<button class="page-btn ' +
      (i === page ? 'active' : '') +
      '" onclick="' +
      func +
      '(' +
      i +
      ')">' +
      i +
      '</button>';
  }
  html +=
    '<button class="page-btn" onclick="' +
    func +
    '(' +
    Math.min(total, page + 1) +
    ')">▶</button><span class="pagination-info">Page ' +
    page +
    ' of ' +
    total +
    '</span>';
  return html;
}

function changeAllPage(p) {
  allState.page = p;
  renderAllParts();
}

function renderNeedOrder() {
  let needParts = parts.filter(function (p) {
    return p.currentQty < p.baselineQty;
  });
  if (needState.search && needState.search.length > 0) {
    let searchTerm = needState.search.toLowerCase();
    needParts = needParts.filter(function (p) {
      return (
        p.partNumber.toLowerCase().indexOf(searchTerm) !== -1 ||
        p.description.toLowerCase().indexOf(searchTerm) !== -1
      );
    });
  }
  let tbody = document.getElementById('needOrderBody');
  if (tbody) {
    if (needParts.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;padding:30px;">No parts need ordering<\/td><\/tr>';
    } else {
      let html = '';
      for (let i = 0; i < needParts.length; i++) {
        let p = needParts[i];
        let shortage = p.baselineQty - p.currentQty;
        html +=
          '<tr>' +
          '<td><span class="clickable-part" onclick="showPartDetails(' +
          p.id +
          ')"><strong>' +
          escapeHtml(p.partNumber) +
          '</strong></span></td>' +
          '<td>' +
          escapeHtml(p.description).substring(0, 40) +
          '</td>' +
          '<td><span class="current-qty-display">' +
          p.currentQty +
          '</span></td>' +
          '<td>' +
          p.baselineQty +
          '</td>' +
          '<td style="color:#e76f51;font-weight:600;">' +
          shortage +
          '<\/td>' +
          '<\/tr>';
      }
      tbody.innerHTML = html;
    }
  }
}

function renderCritical() {
  let criticalParts = parts.filter(function (p) {
    return p.currentQty < p.baselineQty * 0.5;
  });
  if (criticalState.search && criticalState.search.length > 0) {
    let searchTerm = criticalState.search.toLowerCase();
    criticalParts = criticalParts.filter(function (p) {
      return (
        p.partNumber.toLowerCase().indexOf(searchTerm) !== -1 ||
        p.description.toLowerCase().indexOf(searchTerm) !== -1
      );
    });
  }
  let tbody = document.getElementById('criticalBody');
  if (tbody) {
    if (criticalParts.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;padding:30px;">No critical parts<\/td><\/tr>';
    } else {
      let html = '';
      for (let i = 0; i < criticalParts.length; i++) {
        let p = criticalParts[i];
        let percent = Math.round((p.currentQty / p.baselineQty) * 100);
        html +=
          '<tr class="stock-critical">' +
          '<td><span class="clickable-part" onclick="showPartDetails(' +
          p.id +
          ')"><strong>' +
          escapeHtml(p.partNumber) +
          '</strong></span></td>' +
          '<td>' +
          escapeHtml(p.description).substring(0, 40) +
          '</td>' +
          '<td><span class="current-qty-display">' +
          p.currentQty +
          '</span></td>' +
          '<td>' +
          p.baselineQty +
          '</td>' +
          '<td style="color:#c2410c;font-weight:600;">' +
          percent +
          '%<\/td>' +
          '<\/tr>';
      }
      tbody.innerHTML = html;
    }
  }
}

function renderLogs() {
  let filtered = usageLogs;
  if (logsSearch && logsSearch.length > 0) {
    filtered = usageLogs.filter(function (l) {
      return (
        l.partNumber.toLowerCase().indexOf(logsSearch) !== -1 ||
        (l.note || '').toLowerCase().indexOf(logsSearch) !== -1
      );
    });
  }
  document.getElementById('logCount').innerHTML = '(' + filtered.length + ')';
  let container = document.getElementById('logsListContainer');
  if (container) {
    if (filtered.length === 0) {
      container.innerHTML =
        '<div style="padding:60px;text-align:center;color:#94a3b8;">No usage records</div>';
    } else {
      let html = '';
      for (let i = 0; i < filtered.length; i++) {
        let l = filtered[i];
        html +=
          '<div class="log-entry"><div><i class="far fa-calendar-alt"></i> ' +
          escapeHtml(l.date) +
          '</div><div><strong>' +
          escapeHtml(l.partNumber) +
          '</strong> <span style="color:#e76f51;">-' +
          l.qtyUsed +
          '</span></div><div><i class="fas fa-comment"></i> ' +
          escapeHtml(l.note || '—') +
          '</div><div>' +
          l.previousStock +
          ' → ' +
          l.newStock +
          '</div><div><button class="icon-btn" onclick="openEditLog(' +
          l.id +
          ')"><i class="fas fa-edit"></i></button></div></div>';
      }
      container.innerHTML = html;
    }
  }
}

function refreshAll() {
  renderAllParts();
  renderNeedOrder();
  renderCritical();
  renderLogs();
}

window.openEditPart = function (id) {
  let p = parts.find(function (x) {
    return x.id === id;
  });
  if (p) {
    currentEditPartId = id;
    document.getElementById('editPartNumber').value = p.partNumber;
    document.getElementById('editDescription').value = p.description;
    document.getElementById('editLocation').value = p.location || '';
    document.getElementById('editCurrentQtyDisplay').innerText = p.currentQty;
    document.getElementById('editCurrentQty').value = p.currentQty;
    document.getElementById('editBaselineQty').value = p.baselineQty;
    displayPartPhotoInEdit(p);
    let takePhotoBtn = document.getElementById('editTakePhotoBtn');
    let removePhotoBtn = document.getElementById('editRemovePhotoBtn');
    let newTakeBtn = takePhotoBtn.cloneNode(true);
    let newRemoveBtn = removePhotoBtn.cloneNode(true);
    takePhotoBtn.parentNode.replaceChild(newTakeBtn, takePhotoBtn);
    removePhotoBtn.parentNode.replaceChild(newRemoveBtn, removePhotoBtn);
    newTakeBtn.onclick = function () {
      openCameraForEdit(p.id);
    };
    newRemoveBtn.onclick = function () {
      handleRemovePhotoInEdit(p.id);
    };
    showModal('editModal');
  }
};

window.openQuickLog = function (id) {
  let p = parts.find(function (x) {
    return x.id === id;
  });
  if (p) {
    selectedPartId = id;
    document.getElementById('partSearchInput').value = p.partNumber;
    let selectedDisplay = document.getElementById('selectedPartDisplay');
    selectedDisplay.innerHTML =
      '<i class="fas fa-check-circle"></i> Selected: <strong>' +
      escapeHtml(p.partNumber) +
      '</strong> - Stock: ' +
      p.currentQty +
      ' units';
    selectedDisplay.classList.add('show');

    // Auto-hide the selected display after 3 seconds
    setTimeout(function () {
      if (selectedDisplay && selectedDisplay.classList) {
        selectedDisplay.classList.remove('show');
      }
    }, 3000);

    document.getElementById('usageQty').value = 1;
    document.getElementById('usageQty').max = p.currentQty;
    document.getElementById('usageNote').value = '';
    document.getElementById('partListDropdown').innerHTML = '';
    document.getElementById('partListDropdown').style.display = 'none';
    showModal('usageModal');
  }
};

window.openEditLog = function (id) {
  let log = usageLogs.find(function (l) {
    return l.id === id;
  });
  if (log) {
    currentEditLogId = id;
    document.getElementById('editLogPartNumber').value = log.partNumber;
    document.getElementById('editLogQty').value = log.qtyUsed;
    document.getElementById('editLogDate').value = log.date;
    document.getElementById('editLogNote').value = log.note || '';
    showModal('editLogModal');
  }
};

function saveEditLog() {
  let log = usageLogs.find(function (l) {
    return l.id === currentEditLogId;
  });
  if (log) {
    let newQty = parseInt(document.getElementById('editLogQty').value);
    if (isNaN(newQty) || newQty <= 0) {
      showToast('Invalid quantity', true);
      return;
    }
    log.qtyUsed = newQty;
    log.date = document.getElementById('editLogDate').value;
    log.note = document.getElementById('editLogNote').value;
    saveData();
    refreshAll();
    hideModal('editLogModal');
    showToast('✓ Log entry updated successfully');
  }
}

function addNewPart() {
  let pn = document.getElementById('newPartNumber').value.trim();
  if (!pn) {
    showToast('Part number required', true);
    return;
  }
  if (
    parts.some(function (p) {
      return p.partNumber === pn;
    })
  ) {
    showToast('Part number already exists', true);
    return;
  }
  let qty = parseInt(document.getElementById('newQuantity').value) || 0;
  let location = document.getElementById('newLocation').value.trim();
  parts.push({
    id: nextPartId++,
    partNumber: pn,
    description:
      document.getElementById('newDescription').value.trim() || 'New Part',
    currentQty: qty,
    baselineQty: qty,
    location: location || '',
  });
  saveData();
  refreshAll();
  hideModal('addPartModal');
  document.getElementById('newPartNumber').value = '';
  document.getElementById('newDescription').value = '';
  document.getElementById('newLocation').value = '';
  document.getElementById('newQuantity').value = 0;
  showToast('✓ Part "' + pn + '" added successfully');
}

function saveEditPart() {
  let p = parts.find(function (x) {
    return x.id === currentEditPartId;
  });
  if (p) {
    let newPn = document.getElementById('editPartNumber').value.trim();
    if (!newPn) {
      showToast('Part number required', true);
      return;
    }
    if (
      parts.some(function (x) {
        return x.id !== currentEditPartId && x.partNumber === newPn;
      })
    ) {
      showToast('Part number already exists', true);
      return;
    }
    p.partNumber = newPn;
    p.description = document.getElementById('editDescription').value;
    p.location = document.getElementById('editLocation').value;
    p.currentQty = parseInt(document.getElementById('editCurrentQty').value);
    p.baselineQty = parseInt(document.getElementById('editBaselineQty').value);
    saveData();
    refreshAll();
    hideModal('editModal');
    showToast('✓ Part updated successfully');
  }
}

function adjustQty(delta) {
  let disp = document.getElementById('editCurrentQtyDisplay');
  let val = parseInt(disp.innerText) + delta;
  if (val < 0) val = 0;
  disp.innerText = val;
  document.getElementById('editCurrentQty').value = val;
}

function showOrderReport() {
  let need = parts.filter(function (p) {
    return p.currentQty < p.baselineQty;
  });
  let container = document.getElementById('reportListContainer');
  let totalNeeded = 0;
  if (need.length === 0) {
    container.innerHTML =
      '<div class="report-empty"><i class="fas fa-check-circle" style="font-size: 3rem; color: #2d6a4f; margin-bottom: 12px; display: block;"></i>All parts have sufficient stock!<br>No orders needed at this time.</div>';
  } else {
    container.innerHTML = '';
    for (let i = 0; i < need.length; i++) {
      let p = need[i];
      let shortage = p.baselineQty - p.currentQty;
      totalNeeded += shortage;
      let div = document.createElement('div');
      div.className = 'report-item';
      div.innerHTML =
        '<div class="report-item-info"><div class="report-item-part">' +
        escapeHtml(p.partNumber) +
        '</div><div class="report-item-desc">' +
        escapeHtml(p.description) +
        '</div></div><div class="report-item-qty">Need ' +
        shortage +
        '</div>';
      container.appendChild(div);
    }
    document.getElementById('reportTotalItems').innerHTML =
      'Total: ' + need.length + ' part(s) | ' + totalNeeded + ' units needed';
  }
  showModal('orderReportModal');
}

function copyOrderAndRedirect() {
  let need = parts.filter(function (p) {
    return p.currentQty < p.baselineQty;
  });
  if (need.length === 0) {
    showToast('No items to order', true);
    return;
  }
  let text = '';
  for (let i = 0; i < need.length; i++) {
    text +=
      need[i].partNumber +
      ' - need ' +
      (need[i].baselineQty - need[i].currentQty) +
      '\n';
  }
  text = text.trim();
  navigator.clipboard
    .writeText(text)
    .then(function () {
      showToast(need.length + ' item(s) copied to clipboard!');
      window.open(
        'https://mckessonpa.atlassian.net/servicedesk/customer/portal/2/group/3/create/14',
        '_blank',
      );
    })
    .catch(function () {
      showToast('Failed to copy', true);
    });
}

function importExcel(rows) {
  if (!rows.length) return;
  let pIdx = 0,
    dIdx = 1,
    qIdx = 2,
    lIdx = -1;
  if (rows[0]) {
    let lower = rows[0].map(function (h) {
      return String(h).toLowerCase();
    });
    pIdx = lower.findIndex(function (h) {
      return h.indexOf('part') !== -1 || h.indexOf('number') !== -1;
    });
    if (pIdx === -1) pIdx = 0;
    dIdx = lower.findIndex(function (h) {
      return h.indexOf('desc') !== -1 || h.indexOf('description') !== -1;
    });
    if (dIdx === -1) dIdx = 1;
    qIdx = lower.findIndex(function (h) {
      return h.indexOf('qty') !== -1 || h.indexOf('quantity') !== -1;
    });
    if (qIdx === -1) qIdx = 2;
    lIdx = lower.findIndex(function (h) {
      return (
        h.indexOf('loc') !== -1 ||
        h.indexOf('location') !== -1 ||
        h.indexOf('position') !== -1
      );
    });
  }
  let start =
    rows[0] && String(rows[0][0]).toLowerCase().indexOf('part') !== -1 ? 1 : 0;
  let added = 0,
    updated = 0;
  for (let i = start; i < rows.length; i++) {
    let row = rows[i];
    if (!row || row.length < 2) continue;
    let pn = row[pIdx] ? String(row[pIdx]).trim() : '';
    if (!pn) continue;
    let desc = row[dIdx] ? String(row[dIdx]).trim() : '';
    let qty = parseFloat(row[qIdx]) || 0;
    let loc = lIdx !== -1 && row[lIdx] ? String(row[lIdx]).trim() : '';
    let existing = parts.find(function (p) {
      return p.partNumber === pn;
    });
    if (existing) {
      existing.description = desc;
      existing.baselineQty = qty;
      if (loc) existing.location = loc;
      updated++;
    } else {
      parts.push({
        id: nextPartId++,
        partNumber: pn,
        description: desc,
        currentQty: qty,
        baselineQty: qty,
        location: loc,
      });
      added++;
    }
  }
  saveData();
  refreshAll();
  showToast('Imported: ' + added + ' new, ' + updated + ' updated');
}

function updatePartDropdown(search) {
  let searchLower = search.toLowerCase();
  let filtered = parts.filter(function (p) {
    return (
      p.partNumber.toLowerCase().indexOf(searchLower) !== -1 ||
      p.description.toLowerCase().indexOf(searchLower) !== -1
    );
  });
  let dropdown = document.getElementById('partListDropdown');
  if (filtered.length === 0) {
    dropdown.innerHTML =
      '<div class="part-option" style="text-align:center;color:#999;">No parts found</div>';
    dropdown.style.display = 'block';
    return;
  }
  dropdown.innerHTML = '';
  dropdown.style.display = 'block';
  for (let i = 0; i < Math.min(filtered.length, 20); i++) {
    let part = filtered[i];
    let div = document.createElement('div');
    div.className = 'part-option';
    div.innerHTML =
      '<strong>' +
      escapeHtml(part.partNumber) +
      '</strong><br><small>' +
      escapeHtml(part.description).substring(0, 40) +
      ' | Stock: ' +
      part.currentQty +
      '</small>';
    div.onclick = (function (p) {
      return function () {
        selectedPartId = p.id;
        let selectedDisplay = document.getElementById('selectedPartDisplay');
        selectedDisplay.innerHTML =
          '<i class="fas fa-check-circle"></i> Selected: <strong>' +
          escapeHtml(p.partNumber) +
          '</strong> - Stock: ' +
          p.currentQty +
          ' units';
        selectedDisplay.classList.add('show');
        document.getElementById('partSearchInput').value = p.partNumber;
        dropdown.style.display = 'none';
        document.getElementById('usageQty').max = p.currentQty;

        // Auto-hide the selected display after 3 seconds
        setTimeout(function () {
          if (selectedDisplay && selectedDisplay.classList) {
            selectedDisplay.classList.remove('show');
          }
        }, 3000);
      };
    })(part);
    dropdown.appendChild(div);
  }
}

function showConfirmDeletePart(partId) {
  let part = parts.find(function (p) {
    return p.id === partId;
  });
  if (!part) return;
  pendingDeletePartId = partId;
  pendingDeleteLogId = null;
  document.getElementById('confirmTitle').innerHTML =
    '<i class="fas fa-trash-alt"></i> Delete Part';
  document.getElementById('confirmMessage').innerHTML =
    'Are you sure you want to permanently delete this part?';
  document.getElementById('confirmDetails').style.display = 'block';
  document.getElementById('confirmDetails').innerHTML =
    '<strong>Part Number:</strong> ' +
    escapeHtml(part.partNumber) +
    '<br><strong>Description:</strong> ' +
    escapeHtml(part.description) +
    '<br><strong>Current Stock:</strong> ' +
    part.currentQty +
    '<br><strong>Baseline:</strong> ' +
    part.baselineQty;
  showModal('confirmDeleteModal');
}

function showConfirmDeleteLog(logId) {
  let log = usageLogs.find(function (l) {
    return l.id === logId;
  });
  if (!log) return;
  pendingDeleteLogId = logId;
  pendingDeletePartId = null;
  document.getElementById('confirmTitle').innerHTML =
    '<i class="fas fa-trash-alt"></i> Delete Log Entry';
  document.getElementById('confirmMessage').innerHTML =
    'Are you sure you want to delete this log entry? Stock quantity will NOT be restored.';
  document.getElementById('confirmDetails').style.display = 'block';
  document.getElementById('confirmDetails').innerHTML =
    '<strong>Part:</strong> ' +
    escapeHtml(log.partNumber) +
    '<br><strong>Quantity Used:</strong> ' +
    log.qtyUsed +
    '<br><strong>Date:</strong> ' +
    escapeHtml(log.date) +
    '<br><strong>Note:</strong> ' +
    escapeHtml(log.note || '—');
  showModal('confirmDeleteModal');
}

function executeDelete() {
  if (pendingDeletePartId !== null) {
    let part = parts.find(function (p) {
      return p.id === pendingDeletePartId;
    });
    if (part) {
      parts = parts.filter(function (p) {
        return p.id !== pendingDeletePartId;
      });
      saveData();
      refreshAll();
      showToast('✓ Part "' + part.partNumber + '" deleted successfully');
    }
    pendingDeletePartId = null;
  } else if (pendingDeleteLogId !== null) {
    let log = usageLogs.find(function (l) {
      return l.id === pendingDeleteLogId;
    });
    if (log) {
      usageLogs = usageLogs.filter(function (l) {
        return l.id !== pendingDeleteLogId;
      });
      saveData();
      refreshAll();
      showToast('✓ Log entry for ' + log.partNumber + ' deleted successfully');
    }
    pendingDeleteLogId = null;
  }
  hideModal('confirmDeleteModal');
}

function cancelDelete() {
  pendingDeletePartId = null;
  pendingDeleteLogId = null;
  pendingPhotoDeletePartId = null;
  hideModal('confirmDeleteModal');
}

// Quantity controls for usage modal
function initUsageQuantityControls() {
  let decrementBtn = document.getElementById('decrementUsageQty');
  let incrementBtn = document.getElementById('incrementUsageQty');
  let qtyInput = document.getElementById('usageQty');

  if (decrementBtn) {
    decrementBtn.onclick = function () {
      let val = parseInt(qtyInput.value) || 1;
      if (val > 1) {
        qtyInput.value = val - 1;
      }
    };
  }

  if (incrementBtn) {
    incrementBtn.onclick = function () {
      let val = parseInt(qtyInput.value) || 1;
      let max = parseInt(qtyInput.getAttribute('max')) || 9999;
      if (val < max) {
        qtyInput.value = val + 1;
      }
    };
  }
}

// Mobile Menu Functions
function initMobileMenu() {
  const hamburger = document.getElementById('hamburgerMenu');
  const dropdown = document.getElementById('mobileDropdown');
  const mobileTabBtns = document.querySelectorAll('.mobile-tab-btn');
  const desktopTabBtns = document.querySelectorAll('.tab-btn');

  if (hamburger) {
    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.toggle('show');
    });
  }

  document.addEventListener('click', function (e) {
    if (dropdown && dropdown.classList.contains('show')) {
      if (!hamburger.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
      }
    }
  });

  mobileTabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      let tabId = this.getAttribute('data-tab');
      mobileTabBtns.forEach(function (b) {
        b.classList.remove('active');
      });
      this.classList.add('active');
      desktopTabBtns.forEach(function (b) {
        if (b.getAttribute('data-tab') === tabId) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
      document.querySelectorAll('.tab-content').forEach(function (tc) {
        tc.classList.remove('active');
      });
      document.getElementById('tab-' + tabId).classList.add('active');
      dropdown.classList.remove('show');
    });
  });

  desktopTabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      let tabId = this.getAttribute('data-tab');
      desktopTabBtns.forEach(function (b) {
        b.classList.remove('active');
      });
      this.classList.add('active');
      mobileTabBtns.forEach(function (b) {
        if (b.getAttribute('data-tab') === tabId) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      });
      document.querySelectorAll('.tab-content').forEach(function (tc) {
        tc.classList.remove('active');
      });
      document.getElementById('tab-' + tabId).classList.add('active');
    });
  });
}

// Event Listeners
document.getElementById('excelUpload').addEventListener('change', function (e) {
  let f = e.target.files[0];
  if (f) {
    let r = new FileReader();
    r.onload = function (ev) {
      let wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
      let rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
        header: 1,
        defval: '',
      });
      if (rows) importExcel(rows);
      e.target.value = '';
    };
    r.readAsArrayBuffer(f);
  }
});

document
  .getElementById('allSearchInput')
  .addEventListener('input', function (e) {
    allState.search = e.target.value.toLowerCase();
    allState.page = 1;
    renderAllParts();
  });
document
  .getElementById('allRowsPerPage')
  .addEventListener('change', function (e) {
    allState.rows = parseInt(e.target.value);
    allState.page = 1;
    renderAllParts();
  });
document
  .getElementById('needSearchInput')
  .addEventListener('input', function (e) {
    needState.search = e.target.value.toLowerCase();
    renderNeedOrder();
  });
document
  .getElementById('criticalSearchInput')
  .addEventListener('input', function (e) {
    criticalState.search = e.target.value.toLowerCase();
    renderCritical();
  });
document
  .getElementById('logsSearchInput')
  .addEventListener('input', function (e) {
    logsSearch = e.target.value.toLowerCase();
    renderLogs();
  });
document.getElementById('reportBtn').onclick = showOrderReport;
document.getElementById('addPartBtn').onclick = function () {
  showModal('addPartModal');
};
document.getElementById('quickLogBtn').onclick = function () {
  if (parts.length === 0) {
    showToast('No parts in inventory', true);
    return;
  }
  selectedPartId = null;
  document.getElementById('partSearchInput').value = '';
  let selectedDisplay = document.getElementById('selectedPartDisplay');
  selectedDisplay.classList.remove('show');
  selectedDisplay.innerHTML = '';
  document.getElementById('partListDropdown').innerHTML = '';
  document.getElementById('partListDropdown').style.display = 'none';
  document.getElementById('usageQty').value = 1;
  document.getElementById('usageQty').max = 9999;
  document.getElementById('usageNote').value = '';
  updatePartDropdown('');
  showModal('usageModal');
};
document.getElementById('scanQrBtn').onclick = openQrScanner;
document.getElementById('manualQrSubmit').onclick = manualQrLookup;
document.getElementById('cancelScanBtn').onclick = closeQrScanner;
document.getElementById('decrementQtyBtn').onclick = function () {
  adjustQty(-1);
};
document.getElementById('incrementQtyBtn').onclick = function () {
  adjustQty(1);
};
document.getElementById('saveEditBtn').onclick = saveEditPart;
document.getElementById('cancelEditBtn').onclick = function () {
  hideModal('editModal');
};
document.getElementById('deleteFromEditBtn').onclick = function () {
  if (currentEditPartId) {
    hideModal('editModal');
    showConfirmDeletePart(currentEditPartId);
  }
};
document.getElementById('saveAddBtn').onclick = addNewPart;
document.getElementById('cancelAddBtn').onclick = function () {
  hideModal('addPartModal');
};
document.getElementById('confirmUsageBtn').onclick = function () {
  if (!selectedPartId) {
    showToast('Select a part', true);
    return;
  }
  let qty = parseInt(document.getElementById('usageQty').value);
  let note = document.getElementById('usageNote').value;
  if (logUsage(selectedPartId, qty, note)) {
    hideModal('usageModal');
    selectedPartId = null;
    document.getElementById('partSearchInput').value = '';
    let selectedDisplay = document.getElementById('selectedPartDisplay');
    selectedDisplay.classList.remove('show');
    selectedDisplay.innerHTML = '';
    document.getElementById('partListDropdown').innerHTML = '';
    document.getElementById('partListDropdown').style.display = 'none';
  }
};
document.getElementById('confirmProceedBtn').onclick = function () {
  if (pendingPhotoDeletePartId !== null) {
    executePhotoDelete();
  } else {
    executeDelete();
  }
};
document.getElementById('confirmCancelBtn').onclick = cancelDelete;
document.getElementById('createOrderBtn').onclick = copyOrderAndRedirect;
document.getElementById('detailsEditBtn').onclick = editFromDetails;
document.getElementById('detailsLogBtn').onclick = logFromDetails;
document
  .getElementById('partSearchInput')
  .addEventListener('input', function (e) {
    updatePartDropdown(e.target.value);
  });
document.getElementById('saveEditLogBtn').onclick = saveEditLog;
document.getElementById('cancelEditLogBtn').onclick = function () {
  hideModal('editLogModal');
};
document.getElementById('deleteLogBtn').onclick = function () {
  if (currentEditLogId) {
    hideModal('editLogModal');
    showConfirmDeleteLog(currentEditLogId);
  }
};
document.getElementById('capturePhotoBtn').onclick = capturePhoto;
document.getElementById('cancelCameraBtn').onclick = closeCamera;

let closeButtons = document.querySelectorAll('.close-modal');
for (let i = 0; i < closeButtons.length; i++) {
  closeButtons[i].addEventListener('click', function (e) {
    e.stopPropagation();
    let modalId = this.getAttribute('data-modal');
    if (modalId) {
      if (modalId === 'qrScannerModal') {
        closeQrScanner();
      } else if (modalId === 'cameraModal') {
        closeCamera();
      } else {
        hideModal(modalId);
      }
    }
  });
}

window.onclick = function (e) {
  if (e.target.classList.contains('modal')) {
    let modalId = e.target.id;
    if (modalId === 'qrScannerModal') {
      closeQrScanner();
    } else if (modalId === 'cameraModal') {
      closeCamera();
    } else {
      hideModal(modalId);
    }
  }
};

// Hide dropdown when clicking outside
document.addEventListener('click', function (e) {
  let dropdown = document.getElementById('partListDropdown');
  let searchInput = document.getElementById('partSearchInput');
  if (dropdown && searchInput) {
    if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  }
});

// Initialize all components
initMobileMenu();
initUsageQuantityControls();

window.changeAllPage = changeAllPage;
window.showPartDetails = showPartDetails;
loadData();
refreshAll();
