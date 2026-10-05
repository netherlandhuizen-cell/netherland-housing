/**
 * NETHERLANDHUIZEN // GEOSPATIAL RADAR TELEMETRY ENGINE
 * ------------------------------------------------------
 * High-tech infrastructure monitoring controller:
 * - CartoDB Dark_Matter high-contrast cyber tile layer
 * - Price-tiered telemetry pill markers (<€1.3k budget, €1.3k-€2k mid, >€2k premium)
 * - Real-time Supabase REST/v1 synchronization
 * - Bi-directional interactive targeting (Cards <-> Map Pins)
 */

// Supabase REST API Configuration
const SUPABASE_CONFIG = {
  url: "https://muvewklupljyjdihylhb.supabase.co",
  anonKey: "sb_publishable_b170CcCV3vutwAkBQtLFAA_UskUprmT",
  table: "properties"
};

// Application State
let allProperties = [];
let filteredProperties = [];
let map = null;
let markersLayer = null;
const propertyMarkersMap = new Map();

// Default Map Center: The Netherlands
const DEFAULT_MAP_CENTER = [52.1326, 5.2913];
const DEFAULT_MAP_ZOOM = 8;

// DOM Cache
const dom = {
  mapWrapper: document.getElementById("map-wrapper"),
  mapOverlay: document.getElementById("map-loading-overlay"),
  statCount: document.getElementById("stat-count"),
  statCities: document.getElementById("stat-cities"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnResetMap: document.getElementById("btn-reset-map"),
  searchInput: document.getElementById("search-input"),
  filterCity: document.getElementById("filter-city"),
  filterMaxPrice: document.getElementById("filter-max-price"),
  filterSort: document.getElementById("filter-sort"),
  btnResetFilters: document.getElementById("btn-reset-filters"),
  listingsGrid: document.getElementById("listings-grid"),
  listingsCountBadge: document.getElementById("listings-count-badge"),
  emptyState: document.getElementById("empty-state"),
  btnClearEmpty: document.getElementById("btn-clear-empty")
};

// ---------------------------------------------------------------------------
// 1. Map Initialization (CartoDB Dark_Matter Tiles)
// ---------------------------------------------------------------------------

function initMap() {
  if (map) return;

  // Initialize Leaflet map with dark theme presets
  map = L.map("map", {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
    zoomControl: false, // Cleaner custom look, or we add custom position
    scrollWheelZoom: true
  });

  // Re-add zoom control to bottom right so it doesn't collide with floating HUD
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // CartoDB Dark_Matter Tiles (Sleek, high-contrast dark cyber aesthetic)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 20
  }).addTo(map);

  // LayerGroup for all telemetry pins
  markersLayer = L.layerGroup().addTo(map);

  // Hide loading overlay once map renders
  map.whenReady(() => {
    dom.mapOverlay.classList.add("hidden");
  });
}

// ---------------------------------------------------------------------------
// 2. Data Ingestion from Supabase REST API
// ---------------------------------------------------------------------------

async function fetchProperties() {
  dom.btnRefresh.classList.add("spinning");
  dom.mapOverlay.classList.remove("hidden");

  try {
    const endpoint = `${SUPABASE_CONFIG.url}/rest/v1/${SUPABASE_CONFIG.table}?select=*&order=id.desc`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "apikey": SUPABASE_CONFIG.anonKey,
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase REST error: HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    allProperties = Array.isArray(data) ? data : [];

    // Parse coordinates and numeric price for high-speed indexing
    allProperties.forEach(prop => {
      prop._numericPrice = extractNumericPrice(prop.price);
      prop._priceTier = determinePriceTier(prop._numericPrice);
      prop._lat = prop.latitude != null ? parseFloat(prop.latitude) : null;
      prop._lon = prop.longitude != null ? parseFloat(prop.longitude) : null;
    });

    updateDynamicCityOptions();
    applyFilters();
  } catch (error) {
    console.error("Telemetry acquisition failed:", error);
    dom.listingsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 2.5rem; background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.4); border-radius: 12px; color: #fecdd3; text-align: center;">
        <h4 style="font-family: var(--font-mono); margin-bottom: 0.5rem; font-weight: 700; color: #fb7185;">⚠ TELEMETRY ACQUISITION OFFLINE</h4>
        <p style="font-size: 0.85rem; font-family: var(--font-mono);">${error.message}</p>
        <p style="font-size: 0.75rem; margin-top: 0.6rem; color: #fda4af;">Check Supabase API configuration or verify project status.</p>
      </div>
    `;
  } finally {
    dom.btnRefresh.classList.remove("spinning");
    dom.mapOverlay.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// 3. Price Tier Determination
// ---------------------------------------------------------------------------

function determinePriceTier(price) {
  if (!price) return "tier-mid";
  if (price < 1300) return "tier-budget";     // Green (< €1,300)
  if (price <= 2000) return "tier-mid";      // Cyan (€1,300 - €2,000)
  return "tier-premium";                     // Purple (> €2,000)
}

// ---------------------------------------------------------------------------
// 4. Filtering, Searching & Sorting
// ---------------------------------------------------------------------------

function applyFilters() {
  const searchTerm = (dom.searchInput.value || "").trim().toLowerCase();
  const selectedCity = (dom.filterCity.value || "all").toLowerCase();
  const maxPrice = dom.filterMaxPrice.value;
  const sortMode = dom.filterSort.value;

  filteredProperties = allProperties.filter(item => {
    // Search Term match across multiple metadata points
    if (searchTerm) {
      const titleMatch = (item.title || "").toLowerCase().includes(searchTerm);
      const cityMatch = (item.city || "").toLowerCase().includes(searchTerm);
      const commuteMatch = (item.commute || "").toLowerCase().includes(searchTerm);
      const priceMatch = (item.price || "").toLowerCase().includes(searchTerm);
      if (!titleMatch && !cityMatch && !commuteMatch && !priceMatch) {
        return false;
      }
    }

    // Sector / City Filter
    if (selectedCity !== "all") {
      const itemCity = (item.city || "").toLowerCase();
      if (!itemCity.includes(selectedCity)) {
        return false;
      }
    }

    // Budget Threshold Filter
    if (maxPrice !== "all") {
      const maxVal = parseFloat(maxPrice);
      if (item._numericPrice && item._numericPrice > maxVal) {
        return false;
      }
    }

    return true;
  });

  // Sorting
  if (sortMode === "price-asc") {
    filteredProperties.sort((a, b) => (a._numericPrice || 0) - (b._numericPrice || 0));
  } else if (sortMode === "price-desc") {
    filteredProperties.sort((a, b) => (b._numericPrice || 0) - (a._numericPrice || 0));
  } else {
    // Recent Signal (id descending)
    filteredProperties.sort((a, b) => (b.id || 0) - (a.id || 0));
  }

  updateStats();
  renderMarkers();
  renderListings();
}

function updateStats() {
  const count = filteredProperties.length;
  dom.statCount.textContent = count;
  dom.listingsCountBadge.textContent = `${count} ${count === 1 ? 'NODE CAPTURED' : 'NODES CAPTURED'}`;

  const citiesSet = new Set(
    allProperties
      .map(p => (p.city || "").trim())
      .filter(c => c.length > 0)
  );
  dom.statCities.textContent = citiesSet.size;
}

function updateDynamicCityOptions() {
  const currentVal = dom.filterCity.value;
  const cities = Array.from(new Set(
    allProperties
      .map(p => (p.city || "").trim())
      .filter(c => c.length > 0)
  )).sort();

  dom.filterCity.innerHTML = `<option value="all">All Sectors (${allProperties.length})</option>`;
  cities.forEach(city => {
    const cityCount = allProperties.filter(p => (p.city || "").trim().toLowerCase() === city.toLowerCase()).length;
    const opt = document.createElement("option");
    opt.value = city.toLowerCase();
    opt.textContent = `${city} [${cityCount}]`;
    dom.filterCity.appendChild(opt);
  });

  if (currentVal && Array.from(dom.filterCity.options).some(o => o.value === currentVal)) {
    dom.filterCity.value = currentVal;
  }
}

// ---------------------------------------------------------------------------
// 5. Leaflet Radar Markers (Sleek Price Data Pills)
// ---------------------------------------------------------------------------

function renderMarkers() {
  if (!map || !markersLayer) return;

  markersLayer.clearLayers();
  propertyMarkersMap.clear();

  const validLatLngs = [];

  filteredProperties.forEach(prop => {
    if (!prop._lat || !prop._lon || isNaN(prop._lat) || isNaN(prop._lon)) {
      return;
    }

    const latLng = [prop._lat, prop._lon];
    validLatLngs.push(latLng);

    const shortPrice = formatShortPrice(prop.price);
    const tier = prop._priceTier || "tier-mid";
    const key = prop.id || prop.link;

    // Custom Rounded Data Pill Marker Icon
    const pinIcon = L.divIcon({
      className: "custom-map-pin",
      html: `
        <div class="data-pill-marker ${tier}" id="marker-pill-${prop.id}">
          <span class="pill-status-dot"></span>
          <span class="pill-price-text">${escapeHtml(shortPrice)}</span>
        </div>
      `,
      iconSize: [85, 26],
      iconAnchor: [42, 13],
      popupAnchor: [0, -16]
    });

    const marker = L.marker(latLng, { icon: pinIcon });

    // High-Tech Cyber Popup Card
    const popupContent = `
      <div class="cyber-popup-card">
        <div class="cyber-popup-header">
          <span class="cyber-popup-city">${escapeHtml(prop.city || 'SECTOR NL')}</span>
          <span class="cyber-popup-price">${escapeHtml(prop.price || 'P.O.R.')}</span>
        </div>
        <div class="cyber-popup-title">${escapeHtml(prop.title || 'Telemetry Node')}</div>
        ${prop.commute ? `<div class="cyber-popup-commute">🚲 ${escapeHtml(prop.commute)}</div>` : ''}
        ${prop.link ? `<a href="${escapeHtml(prop.link)}" target="_blank" rel="noopener noreferrer" class="btn-cyber-popup-link">OPEN SOURCE LISTING ↗</a>` : ''}
      </div>
    `;

    marker.bindPopup(popupContent);
    markersLayer.addLayer(marker);

    if (key) {
      propertyMarkersMap.set(key, marker);
    }
  });

  // Fit bounds if valid coordinates exist
  if (validLatLngs.length > 0) {
    const bounds = L.latLngBounds(validLatLngs);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  } else {
    map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  }
}

function zoomToProperty(key, lat, lon) {
  if (!map) return;

  if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
    map.flyTo([lat, lon], 14, { duration: 1.1 });

    if (window.innerWidth < 1024) {
      dom.mapWrapper.scrollIntoView({ behavior: 'smooth' });
    }

    const marker = propertyMarkersMap.get(key);
    if (marker) {
      setTimeout(() => {
        marker.openPopup();
      }, 650);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Listings Telemetry Cards Rendering
// ---------------------------------------------------------------------------

function renderListings() {
  dom.listingsGrid.innerHTML = "";

  if (filteredProperties.length === 0) {
    dom.emptyState.classList.remove("hidden");
    return;
  }

  dom.emptyState.classList.add("hidden");

  const fragment = document.createDocumentFragment();

  filteredProperties.forEach(prop => {
    const card = document.createElement("article");
    const tier = prop._priceTier || "tier-mid";
    card.className = `cyber-card ${tier}`;

    const key = prop.id || prop.link;
    const hasCoords = prop._lat != null && prop._lon != null && !isNaN(prop._lat) && !isNaN(prop._lon);

    card.innerHTML = `
      <div>
        <div class="card-top-row">
          <span class="card-sector-tag">${escapeHtml(prop.city || 'SECTOR')}</span>
          <span class="card-price-tag">${escapeHtml(prop.price || '€ --')}</span>
        </div>
        <h3 class="card-title">${escapeHtml(prop.title || 'Housing Unit')}</h3>
      </div>

      <div class="card-telemetry-specs">
        ${prop.size ? `<span class="cyber-spec-badge" title="Floor Area">📐 ${escapeHtml(prop.size)}</span>` : ''}
        ${prop.rooms ? `<span class="cyber-spec-badge" title="Room Count">🛏️ ${escapeHtml(prop.rooms)} ${parseInt(prop.rooms) === 1 ? 'room' : 'rooms'}</span>` : ''}
        ${prop.interior ? `<span class="cyber-spec-badge" title="Interior Setup">🛋️ ${escapeHtml(prop.interior)}</span>` : ''}
        ${prop.commute ? `<div class="cyber-commute-badge" title="OSRM Calculated Commute">🚲 <span>${escapeHtml(prop.commute)}</span></div>` : ''}
      </div>

      <div class="card-actions-row">
        ${hasCoords ? `
          <button class="btn-radar-locate" data-key="${escapeHtml(key)}" data-lat="${prop._lat}" data-lon="${prop._lon}" title="Lock Target on Radar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
            <span>TARGET</span>
          </button>
        ` : ''}
        ${prop.link ? `
          <a href="${escapeHtml(prop.link)}" target="_blank" rel="noopener noreferrer" class="btn-card-source">
            <span>SOURCE INTEL</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        ` : ''}
      </div>
    `;

    // Interactive targeting button
    const locateBtn = card.querySelector(".btn-radar-locate");
    if (locateBtn) {
      locateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        zoomToProperty(key, prop._lat, prop._lon);
      });
    }

    // Card hover highlights corresponding pin on the map
    card.addEventListener("mouseenter", () => {
      const pinElement = document.getElementById(`marker-pill-${prop.id}`);
      if (pinElement) {
        pinElement.classList.add("active-pin");
      }
    });

    card.addEventListener("mouseleave", () => {
      const pinElement = document.getElementById(`marker-pill-${prop.id}`);
      if (pinElement) {
        pinElement.classList.remove("active-pin");
      }
    });

    fragment.appendChild(card);
  });

  dom.listingsGrid.appendChild(fragment);
}

// ---------------------------------------------------------------------------
// 7. Utility Functions
// ---------------------------------------------------------------------------

function extractNumericPrice(priceStr) {
  if (!priceStr) return null;
  const digitsOnly = priceStr.replace(/[^0-9]/g, "");
  if (!digitsOnly) return null;
  const num = parseInt(digitsOnly, 10);
  return isNaN(num) ? null : num;
}

function formatShortPrice(priceStr) {
  if (!priceStr) return "€ --";
  const num = extractNumericPrice(priceStr);
  if (!num) return priceStr.slice(0, 10);
  return `€ ${num.toLocaleString('nl-NL')}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function resetAllFilters() {
  dom.searchInput.value = "";
  dom.filterCity.value = "all";
  dom.filterMaxPrice.value = "all";
  dom.filterSort.value = "newest";
  applyFilters();
}

// ---------------------------------------------------------------------------
// 8. Event Listeners & Bootstrapping
// ---------------------------------------------------------------------------

function setupEventListeners() {
  dom.searchInput.addEventListener("input", debounce(applyFilters, 200));
  dom.filterCity.addEventListener("change", applyFilters);
  dom.filterMaxPrice.addEventListener("change", applyFilters);
  dom.filterSort.addEventListener("change", applyFilters);

  dom.btnResetFilters.addEventListener("click", resetAllFilters);
  dom.btnClearEmpty.addEventListener("click", resetAllFilters);
  dom.btnRefresh.addEventListener("click", fetchProperties);

  dom.btnResetMap.addEventListener("click", () => {
    if (map) {
      map.flyTo(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, { duration: 0.9 });
    }
  });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  setupEventListeners();
  fetchProperties();
});
