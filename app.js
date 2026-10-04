/**
 * NetherlandHuizen Frontend Application
 * ---------------------------------------
 * Fetches real-time properties from Supabase REST API,
 * renders an interactive Leaflet map with geocoded pins,
 * and maintains responsive property listing cards with live filtering.
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

// DOM Elements
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
// 1. Map Initialization (Leaflet.js)
// ---------------------------------------------------------------------------

function initMap() {
  if (map) return;

  // Initialize map
  map = L.map("map", {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
    zoomControl: true,
    scrollWheelZoom: true
  });

  // Esri World Street Map (100% free, public, no API key, zero watermarks)
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, METI, TomTom",
    maxZoom: 19
  }).addTo(map);

  // LayerGroup for all pins
  markersLayer = L.layerGroup().addTo(map);

  // Hide loading overlay once map is loaded
  map.whenReady(() => {
    dom.mapOverlay.classList.add("hidden");
  });
}

// ---------------------------------------------------------------------------
// 2. Data Fetching from Supabase REST API
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
      throw new Error(`Supabase request failed: HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    allProperties = Array.isArray(data) ? data : [];

    // Parse numeric price helper on each property for fast filtering
    allProperties.forEach(prop => {
      prop._numericPrice = extractNumericPrice(prop.price);
      prop._lat = prop.latitude != null ? parseFloat(prop.latitude) : null;
      prop._lon = prop.longitude != null ? parseFloat(prop.longitude) : null;
    });

    updateDynamicCityOptions();
    applyFilters();
  } catch (error) {
    console.error("Failed to load properties from Supabase:", error);
    dom.listingsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 2rem; background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.3); border-radius: 12px; color: #fecdd3; text-align: center;">
        <h4 style="margin-bottom: 0.5rem; font-weight: 700;">Could not connect to Supabase</h4>
        <p style="font-size: 0.85rem;">${error.message}</p>
        <p style="font-size: 0.78rem; margin-top: 0.5rem; color: #fda4af;">Ensure your Supabase project is active and credentials are correct.</p>
      </div>
    `;
  } finally {
    dom.btnRefresh.classList.remove("spinning");
    dom.mapOverlay.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// 3. Filtering, Searching, & Sorting Logic
// ---------------------------------------------------------------------------

function applyFilters() {
  const searchTerm = (dom.searchInput.value || "").trim().toLowerCase();
  const selectedCity = (dom.filterCity.value || "all").toLowerCase();
  const maxPrice = dom.filterMaxPrice.value;
  const sortMode = dom.filterSort.value;

  filteredProperties = allProperties.filter(item => {
    // Search Term match
    if (searchTerm) {
      const titleMatch = (item.title || "").toLowerCase().includes(searchTerm);
      const cityMatch = (item.city || "").toLowerCase().includes(searchTerm);
      const commuteMatch = (item.commute || "").toLowerCase().includes(searchTerm);
      const priceMatch = (item.price || "").toLowerCase().includes(searchTerm);
      if (!titleMatch && !cityMatch && !commuteMatch && !priceMatch) {
        return false;
      }
    }

    // City Filter
    if (selectedCity !== "all") {
      const itemCity = (item.city || "").toLowerCase();
      if (!itemCity.includes(selectedCity)) {
        return false;
      }
    }

    // Max Price Filter
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
    // Newest first (id desc)
    filteredProperties.sort((a, b) => (b.id || 0) - (a.id || 0));
  }

  // Update UI components
  updateStats();
  renderMarkers();
  renderListings();
}

function updateStats() {
  const count = filteredProperties.length;
  dom.statCount.textContent = count;
  dom.listingsCountBadge.textContent = `${count} ${count === 1 ? 'property' : 'properties'}`;

  // Unique cities count
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

  // Rebuild select options
  dom.filterCity.innerHTML = `<option value="all">All Cities (${allProperties.length})</option>`;
  cities.forEach(city => {
    const cityCount = allProperties.filter(p => (p.city || "").trim().toLowerCase() === city.toLowerCase()).length;
    const opt = document.createElement("option");
    opt.value = city.toLowerCase();
    opt.textContent = `${city} (${cityCount})`;
    dom.filterCity.appendChild(opt);
  });

  // Restore previous selection if still available
  if (currentVal && Array.from(dom.filterCity.options).some(o => o.value === currentVal)) {
    dom.filterCity.value = currentVal;
  }
}

// ---------------------------------------------------------------------------
// 4. Leaflet Map Markers & Popups
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

    // Format clean display price for pin bubble (e.g. € 1.850)
    const shortPrice = formatShortPrice(prop.price);

    // Custom HTML Pin Icon
    const pinIcon = L.divIcon({
      className: "custom-map-pin",
      html: `
        <div class="pin-bubble" title="${escapeHtml(prop.title)}">
          <span>🏠</span>
          <span>${escapeHtml(shortPrice)}</span>
        </div>
      `,
      iconSize: [80, 28],
      iconAnchor: [40, 14],
      popupAnchor: [0, -18]
    });

    // Create marker
    const marker = L.marker(latLng, { icon: pinIcon });

    // Popup HTML
    const popupContent = `
      <div class="map-popup-card">
        <div class="map-popup-header">
          <span class="map-popup-city">${escapeHtml(prop.city || 'Netherlands')}</span>
          <span class="map-popup-price">${escapeHtml(prop.price || '')}</span>
        </div>
        <div class="map-popup-title">${escapeHtml(prop.title || 'Rental Property')}</div>
        ${prop.commute ? `<div class="map-popup-commute">🚲 ${escapeHtml(prop.commute)}</div>` : ''}
        ${prop.link ? `<a href="${escapeHtml(prop.link)}" target="_blank" rel="noopener noreferrer" class="btn-popup-link">View Listing Details ↗</a>` : ''}
      </div>
    `;

    marker.bindPopup(popupContent);
    markersLayer.addLayer(marker);

    // Store reference by property ID / link
    const key = prop.id || prop.link;
    if (key) {
      propertyMarkersMap.set(key, marker);
    }
  });

  // Automatically adjust map viewport if we have pins
  if (validLatLngs.length > 0) {
    const bounds = L.latLngBounds(validLatLngs);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  } else {
    map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  }
}

function zoomToProperty(key, lat, lon) {
  if (!map) return;

  if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
    map.flyTo([lat, lon], 14, { duration: 1.2 });
    
    // Smoothly scroll map into view on mobile
    if (window.innerWidth < 768) {
      dom.mapWrapper.scrollIntoView({ behavior: 'smooth' });
    }

    // Open marker popup if found
    const marker = propertyMarkersMap.get(key);
    if (marker) {
      setTimeout(() => {
        marker.openPopup();
      }, 700);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Listings Cards Rendering
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
    card.className = "property-card";

    const key = prop.id || prop.link;
    const hasCoords = prop._lat != null && prop._lon != null && !isNaN(prop._lat) && !isNaN(prop._lon);

    card.innerHTML = `
      <div>
        <div class="card-top">
          <span class="city-badge">${escapeHtml(prop.city || 'Netherlands')}</span>
          <span class="price-tag">${escapeHtml(prop.price || 'Price on request')}</span>
        </div>
        <h4 class="card-title">${escapeHtml(prop.title || 'Rental Listing')}</h4>
      </div>

      <div class="specs-list">
        ${prop.size ? `<span class="spec-pill" title="Living Area">📏 ${escapeHtml(prop.size)}</span>` : ''}
        ${prop.rooms ? `<span class="spec-pill" title="Bedrooms / Rooms">🛏️ ${escapeHtml(prop.rooms)} ${parseInt(prop.rooms) === 1 ? 'room' : 'rooms'}</span>` : ''}
        ${prop.interior ? `<span class="spec-pill" title="Furnishing">🛋️ ${escapeHtml(prop.interior)}</span>` : ''}
        ${prop.commute ? `<div class="commute-pill" title="Cycling time to Central Station">🚲 <span>${escapeHtml(prop.commute)}</span></div>` : ''}
      </div>

      <div class="card-actions">
        ${hasCoords ? `
          <button class="btn-locate" data-key="${escapeHtml(key)}" data-lat="${prop._lat}" data-lon="${prop._lon}" title="Locate on Map">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
            <span>Map</span>
          </button>
        ` : ''}
        ${prop.link ? `
          <a href="${escapeHtml(prop.link)}" target="_blank" rel="noopener noreferrer" class="btn-card-primary">
            <span>View Listing</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        ` : ''}
      </div>
    `;

    // Click handler on "Locate on Map" button
    const locateBtn = card.querySelector(".btn-locate");
    if (locateBtn) {
      locateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        zoomToProperty(key, prop._lat, prop._lon);
      });
    }

    fragment.appendChild(card);
  });

  dom.listingsGrid.appendChild(fragment);
}

// ---------------------------------------------------------------------------
// 6. Utility Functions
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
// 7. Event Listeners & Initialization
// ---------------------------------------------------------------------------

function setupEventListeners() {
  // Filter events
  dom.searchInput.addEventListener("input", debounce(applyFilters, 250));
  dom.filterCity.addEventListener("change", applyFilters);
  dom.filterMaxPrice.addEventListener("change", applyFilters);
  dom.filterSort.addEventListener("change", applyFilters);

  // Buttons
  dom.btnResetFilters.addEventListener("click", resetAllFilters);
  dom.btnClearEmpty.addEventListener("click", resetAllFilters);
  dom.btnRefresh.addEventListener("click", fetchProperties);

  dom.btnResetMap.addEventListener("click", () => {
    if (map) {
      map.flyTo(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, { duration: 1.0 });
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
