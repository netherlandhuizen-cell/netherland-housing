/**
 * NetherlandHuizen Frontend Application
 * ---------------------------------------
 * Clean modern SaaS rental tracker (Vercel/Stripe style)
 * - Zero-watermark, reliable map tiles (Esri Dark Gray & OpenStreetMap)
 * - Subtle, clean price pill markers with color-coded dots
 * - Real-time Supabase REST API connection
 * - Filter by search query, city, budget, and price sort
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
// 1. Map Initialization (Clean, 100% Free, Zero-Watermark Tiles)
// ---------------------------------------------------------------------------

function initMap() {
  if (map) return;

  // Initialize map
  map = L.map("map", {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
    zoomControl: false,
    scrollWheelZoom: true
  });

  // Re-add zoom control to bottom right
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // Layer 1: Minimalist Dark Canvas (Esri World Dark Gray Base - Clean, neutral, zero watermarks)
  const darkCanvas = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme",
      maxZoom: 18,
      maxNativeZoom: 16
    }
  );

  // Layer 2: Muted Dark Vector (OpenStreetMap with toned-down, muted dark styling)
  const mutedDark = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: "muted-dark-tiles"
    }
  );

  // Layer 3: Satellite Hybrid (Satellite terrain with clear roads & labels)
  const satelliteBase = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri &mdash; Esri, i-cubed, USDA, USGS",
      maxZoom: 19
    }
  );
  const boundariesOverlay = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19
    }
  );
  const satelliteHybrid = L.layerGroup([satelliteBase, boundariesOverlay]);

  // Layer 4: Topographic Terrain
  const topoMap = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri &mdash; DeLorme, NAVTEQ, TomTom",
      maxZoom: 19
    }
  );

  // Set Satellite Hybrid as default active map layer on startup
  satelliteHybrid.addTo(map);

  // Add clean layer switcher control
  const baseLayers = {
    "Satellite Hybrid": satelliteHybrid,
    "Minimal Dark Canvas": darkCanvas,
    "Muted Dark Vector": mutedDark,
    "Topographic Terrain": topoMap
  };
  L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);

  // LayerGroup for all pins
  markersLayer = L.layerGroup().addTo(map);

  // Hide loading overlay once map is loaded
  map.whenReady(() => {
    dom.mapOverlay.classList.add("hidden");
  });
}

// ---------------------------------------------------------------------------
// 2. Fetch Data from Supabase REST API
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
      throw new Error(`Failed to fetch listings: HTTP ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const rawProperties = Array.isArray(data) ? data : [];

    // Filter out properties under €100 (parking spots, storage units, €0 or €10 placeholders)
    allProperties = rawProperties.filter(prop => {
      const num = extractNumericPrice(prop.price);
      return num === null || num >= 100;
    });

    // Parse numeric price and price tier for filtering
    allProperties.forEach(prop => {
      prop._numericPrice = extractNumericPrice(prop.price);
      prop._tier = determineTier(prop._numericPrice);
      prop._lat = prop.latitude != null ? parseFloat(prop.latitude) : null;
      prop._lon = prop.longitude != null ? parseFloat(prop.longitude) : null;
    });

    updateDynamicCityOptions();
    applyFilters();
  } catch (error) {
    console.error("Supabase connection error:", error);
    dom.listingsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 2rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 10px; color: #fca5a5; text-align: center;">
        <h4 style="margin-bottom: 0.4rem; font-weight: 600;">Unable to connect to Supabase</h4>
        <p style="font-size: 0.85rem;">${escapeHtml(error.message)}</p>
        <p style="font-size: 0.78rem; margin-top: 0.5rem; color: #f87171;">Please ensure your Supabase project is active.</p>
      </div>
    `;
  } finally {
    dom.btnRefresh.classList.remove("spinning");
    dom.mapOverlay.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// 3. Price Tier Classification
// ---------------------------------------------------------------------------

function determineTier(price) {
  if (!price) return "tier-mid";
  if (price < 1300) return "tier-budget";    // Budget (< €1,300)
  if (price <= 2000) return "tier-mid";       // Mid-tier (€1,300 - €2,000)
  return "tier-high";                         // Upper tier (> €2,000)
}

// ---------------------------------------------------------------------------
// 4. Filtering, Searching, & Sorting Logic
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

  updateStats();
  renderMarkers();
  renderListings();
}

function updateStats() {
  const count = filteredProperties.length;
  dom.statCount.textContent = count;
  dom.listingsCountBadge.textContent = `${count} ${count === 1 ? 'property' : 'properties'}`;

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

  dom.filterCity.innerHTML = `<option value="all">All Cities (${allProperties.length})</option>`;
  cities.forEach(city => {
    const cityCount = allProperties.filter(p => (p.city || "").trim().toLowerCase() === city.toLowerCase()).length;
    const opt = document.createElement("option");
    opt.value = city.toLowerCase();
    opt.textContent = `${city} (${cityCount})`;
    dom.filterCity.appendChild(opt);
  });

  if (currentVal && Array.from(dom.filterCity.options).some(o => o.value === currentVal)) {
    dom.filterCity.value = currentVal;
  }
}

// ---------------------------------------------------------------------------
// 5. Leaflet Map Markers & Popups (Clean Price Pills)
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
    const tier = prop._tier || "tier-mid";
    const key = prop.id || prop.link;

    // Clean Rounded Price Pill Marker
    const pinIcon = L.divIcon({
      className: "custom-map-pin",
      html: `
        <div class="price-pill-pin ${tier}" id="marker-pill-${prop.id}">
          <span class="pin-dot"></span>
          <span>${escapeHtml(shortPrice)}</span>
        </div>
      `,
      iconSize: [80, 26],
      iconAnchor: [40, 13],
      popupAnchor: [0, -15]
    });

    const marker = L.marker(latLng, { icon: pinIcon });

    const popupPrice = (prop.price && String(prop.price).toLowerCase().includes("netto"))
      ? formatShortPrice(prop.price)
      : (prop.price || '');

    const popupCity = prop.city || 'Netherlands';
    const popupTitle = prop.title || 'Rental Listing';
    const popupDirectLink = prop.link || window.location.href;
    const popupWhatsappMessage = `Check out this rental in ${popupCity}: ${popupTitle} - ${popupPrice}! ${popupDirectLink}`;
    const popupWhatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(popupWhatsappMessage)}`;

    // Clean Minimalist Popup
    const popupContent = `
      <div class="clean-popup-card">
        <div class="clean-popup-header">
          <span class="clean-popup-city">${escapeHtml(popupCity)}</span>
          <span class="clean-popup-price">${escapeHtml(popupPrice)}</span>
        </div>
        <div class="clean-popup-title">${escapeHtml(popupTitle)}</div>
        ${prop.commute ? `<div class="clean-popup-commute">🚲 ${escapeHtml(prop.commute)}</div>` : ''}
        <div class="popup-actions">
          ${prop.link ? `<a href="${escapeHtml(prop.link)}" target="_blank" rel="noopener noreferrer" class="btn-popup-link">View Listing ↗</a>` : ''}
          <a href="${escapeHtml(popupWhatsappUrl)}" target="_blank" rel="noopener noreferrer" class="btn-popup-whatsapp" title="Share via WhatsApp">
            <svg class="icon-whatsapp" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            <span>WhatsApp</span>
          </a>
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    markersLayer.addLayer(marker);

    if (key) {
      propertyMarkersMap.set(key, marker);
    }
  });

  // Adjust view bounds to fit pins
  if (validLatLngs.length > 0) {
    const bounds = L.latLngBounds(validLatLngs);
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  } else {
    map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
  }
}

function zoomToProperty(key, lat, lon) {
  if (!map) return;

  if (lat && lon && !isNaN(lat) && !isNaN(lon)) {
    map.flyTo([lat, lon], 14, { duration: 1.1 });

    if (window.innerWidth < 768) {
      dom.mapWrapper.scrollIntoView({ behavior: 'smooth' });
    }

    const marker = propertyMarkersMap.get(key);
    if (marker) {
      setTimeout(() => {
        marker.openPopup();
      }, 600);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Listings Cards Rendering
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
    const cardPrice = (prop.price && String(prop.price).toLowerCase().includes("netto"))
      ? `${formatShortPrice(prop.price)} / mo`
      : (prop.price || 'Price on request');

    // Pre-filled WhatsApp message for viral sharing
    const city = prop.city || "Netherlands";
    const title = prop.title || "Rental Listing";
    const directLink = prop.link || window.location.href;
    const whatsappMessage = `Check out this rental in ${city}: ${title} - ${cardPrice}! ${directLink}`;
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappMessage)}`;

    card.innerHTML = `
      <div>
        <div class="card-top">
          <span class="card-city-tag">${escapeHtml(prop.city || 'Netherlands')}</span>
          <span class="card-price">${escapeHtml(cardPrice)}</span>
        </div>
        <h3 class="card-title">${escapeHtml(prop.title || 'Rental Listing')}</h3>
      </div>

      <div class="card-specs">
        ${prop.size ? `<span class="spec-pill" title="Living Area">📏 ${escapeHtml(prop.size)}</span>` : ''}
        ${prop.rooms ? `<span class="spec-pill" title="Rooms">🛏️ ${escapeHtml(prop.rooms)} ${parseInt(prop.rooms) === 1 ? 'room' : 'rooms'}</span>` : ''}
        ${prop.interior ? `<span class="spec-pill" title="Furnishing">🛋️ ${escapeHtml(prop.interior)}</span>` : ''}
        ${prop.commute ? `<div class="commute-pill" title="Bike commute to central station">🚲 <span>${escapeHtml(prop.commute)}</span></div>` : ''}
      </div>

      <div class="card-actions">
        ${hasCoords ? `
          <button class="btn-card-locate" data-key="${escapeHtml(key)}" data-lat="${prop._lat}" data-lon="${prop._lon}" title="Locate on Map">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
            <span>Show on Map</span>
          </button>
        ` : ''}
        ${prop.link ? `
          <a href="${escapeHtml(prop.link)}" target="_blank" rel="noopener noreferrer" class="btn-card-link" title="Open original rental listing">
            <span>View Listing</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        ` : ''}
        <a href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer" class="btn-card-whatsapp" title="Share property to WhatsApp">
          <svg class="icon-whatsapp" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          <span>Share to WhatsApp</span>
        </a>
      </div>
    `;

    // Locate button click handler
    const locateBtn = card.querySelector(".btn-card-locate");
    if (locateBtn) {
      locateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        zoomToProperty(key, prop._lat, prop._lon);
      });
    }

    // Hover card highlights corresponding pin on the map
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
  const text = String(priceStr).trim();

  // 1. If string explicitly mentions 'brutto' or has parentheses with brutto
  let targetNumStr = null;
  const bruttoMatch = text.match(/(?:€\s*)?([0-9]+[0-9.,]*)\s*(?:euro)?\s*brutto/i) 
                   || text.match(/brutto[:\s]*(?:€\s*)?([0-9]+[0-9.,]*)/i);
  if (bruttoMatch) {
    targetNumStr = bruttoMatch[1];
  } else if (/netto/i.test(text)) {
    const parenMatch = text.match(/\(\s*(?:€\s*)?([0-9]+[0-9.,]*)[^)]*\)/);
    if (parenMatch) {
      targetNumStr = parenMatch[1];
    }
  }

  // 2. Standard single price
  if (!targetNumStr) {
    const cleaned = text.replace(/€/g, "").trim();
    const matches = cleaned.match(/[0-9]+[0-9.,]*/g);
    if (matches && matches.length > 0) {
      targetNumStr = matches[0];
    }
  }

  if (!targetNumStr) return null;

  let val = targetNumStr.trim();
  // Handle European vs US decimal / thousand separators
  if (val.includes(",") && val.includes(".")) {
    if (val.lastIndexOf(",") > val.lastIndexOf(".")) {
      val = val.replace(/\./g, "").replace(",", ".");
    } else {
      val = val.replace(/,/g, "");
    }
  } else if (val.includes(",")) {
    const parts = val.split(",");
    if (parts[parts.length - 1].length === 2) {
      val = val.replace(",", ".");
    } else {
      val = val.replace(/,/g, "");
    }
  } else if (val.includes(".")) {
    const parts = val.split(".");
    if (parts[parts.length - 1].length === 3) {
      val = val.replace(/\./g, "");
    }
  }

  const num = parseFloat(val);
  return isNaN(num) ? null : Math.round(num);
}

function formatShortPrice(priceStr) {
  if (!priceStr) return "€ --";
  const num = extractNumericPrice(priceStr);
  if (!num) return String(priceStr).slice(0, 10);
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
// 8. Event Listeners & Bootstrap
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
