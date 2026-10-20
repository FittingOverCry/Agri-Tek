
import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE = (
  process.env.REACT_APP_API_BASE_URL || "http://127.0.0.1:5000"
).replace(/\/+$/, "");

const PRESETS = {
  Balanced: { threshold: 35, description: "A general-purpose starting point." },
  "Thirsty Plants": { threshold: 50, description: "Uses a higher moisture trigger." },
  "Water Saver": { threshold: 25, description: "Uses a lower moisture trigger." },
};

const DEFAULT_SETTINGS = {
  refreshSeconds: 2,
  historyMinutes: 30,
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function formatValue(value, suffix = "") {
  return value === null || value === undefined ? "--" : `${value}${suffix}`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Icon({ name }) {
  const icons = {
    plant: "🌿",
    leaf: "🌱",
    water: "💧",
    temp: "🌡️",
    humidity: "☁️",
    rain: "🌧️",
    pump: "⚙️",
    chart: "📈",
    settings: "⚙",
    clock: "◷",
    wifi: "⌁",
  };

  return (
    <span className={`icon icon-${name}`} aria-hidden="true">
      {icons[name] || "•"}
    </span>
  );
}

function MetricCard({ icon, label, value, unit, note, tone = "" }) {
  const iconTone = {
    green: "soil-icon",
    orange: "temp-icon",
    blue: "humidity-icon",
    purple: "rain-icon",
    teal: "pump-icon",
  }[tone] || "soil-icon";

  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top">
        <span className={`metric-icon ${iconTone}`}>
          <Icon name={icon} />
        </span>
        <span className="metric-label">{label}</span>
      </div>

      <div className="metric-value">
        {formatValue(value)}
        <span>{unit}</span>
      </div>

      <p className="metric-note">{note}</p>
    </article>
  );
}

function LineChart({ points, dataKey, color, label, unit = "" }) {
  const values = points
    .map((point) => point[dataKey])
    .filter((value) => Number.isFinite(value));

  if (values.length < 2) {
    return (
      <div className="chart-empty">
        Collecting readings… at least two valid readings are needed for this chart.
      </div>
    );
  }

  const width = 600;
  const height = 180;
  const pad = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const validPoints = points
    .map((point, index) => ({ point, index }))
    .filter(({ point }) => Number.isFinite(point[dataKey]));

  const coords = validPoints.map(({ point, index }) => ({
    x: pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2),
    y:
      height -
      pad -
      ((point[dataKey] - min) / range) * (height - pad * 2),
    value: point[dataKey],
  }));

  const path = coords
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const latest = coords[coords.length - 1]?.value;

  return (
    <div className="chart-wrap">
      <div className="chart-summary">
        <span>{label}</span>
        <strong>{formatValue(latest, unit)}</strong>
      </div>

      <svg
        className="line-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label} history chart`}
      >
        {[0, 1, 2, 3].map((line) => {
          const y = pad + (line / 3) * (height - pad * 2);

          return (
            <line
              key={line}
              x1={pad}
              y1={y}
              x2={width - pad}
              y2={y}
              className="chart-grid"
            />
          );
        })}

        <path d={path} fill="none" stroke={color} strokeWidth="3" />

        {coords.map((point, index) => (
          <circle
            key={`${point.x}-${index}`}
            cx={point.x}
            cy={point.y}
            r="3"
            fill={color}
          >
            <title>{`${point.value}${unit}`}</title>
          </circle>
        ))}
      </svg>

      <div className="chart-axis">
        <span>{formatTime(points[0].time)}</span>
        <span>{formatTime(points[points.length - 1].time)}</span>
      </div>

      <div className="chart-range">
        Range: {Math.min(...values).toFixed(1)}–{Math.max(...values).toFixed(1)}
        {unit}
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("Overview");
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [lastSuccess, setLastSuccess] = useState(null);
  const [lastAttempt, setLastAttempt] = useState(null);
  const [error, setError] = useState("");
  const [apiReachable, setApiReachable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("Balanced");
  const [threshold, setThreshold] = useState(PRESETS.Balanced.threshold);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("agri-tek-theme") === "dark"
        ? "dark"
        : "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("agri-tek-theme", theme);
    } catch {
      // The dashboard still works if browser storage is unavailable.
    }
  }, [theme]);

  const readData = useCallback(async () => {
    setLastAttempt(Date.now());

    try {
      const response = await fetch(`${API_BASE}/api/data`, {
        headers: { Accept: "application/json" },
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || `API returned HTTP ${response.status}`);
      }

      const normalized = {
        soil_moisture: numberOrNull(payload.soil_moisture),
        temperature: numberOrNull(payload.temperature),
        humidity: numberOrNull(payload.humidity),
        rain: typeof payload.rain === "boolean" ? payload.rain : null,
        pump: typeof payload.pump === "boolean" ? payload.pump : null,
        mode: ["AUTO", "MANUAL"].includes(payload.mode)
          ? payload.mode
          : "UNKNOWN",
        connected: payload.connected === true,
      };

      if (!normalized.connected) {
        throw new Error(
          "Flask responded, but the hardware connection is not confirmed."
        );
      }

      setData(normalized);
      setApiReachable(true);
      setLastSuccess(Date.now());
      setError("");

      setHistory((previous) => {
        const now = Date.now();

        const next = [
          ...previous,
          {
            time: now,
            soil_moisture: normalized.soil_moisture,
            temperature: normalized.temperature,
            humidity: normalized.humidity,
          },
        ];

        const cutoff = now - settings.historyMinutes * 60 * 1000;

        return next
          .filter((point) => point.time >= cutoff)
          .slice(-1200);
      });
    } catch (err) {
      setApiReachable(false);
      setError(err.message || "Unable to contact the Flask API.");
    } finally {
      setLoading(false);
    }
  }, [settings.historyMinutes]);

  useEffect(() => {
    readData();

    const timer = setInterval(readData, settings.refreshSeconds * 1000);

    return () => clearInterval(timer);
  }, [readData, settings.refreshSeconds]);

  const isFresh =
    lastSuccess !== null && Date.now() - lastSuccess < 10000;

  const live = apiReachable && isFresh && data?.connected === true;

  const chartPoints = useMemo(
    () =>
      history.filter(
        (point) =>
          point.soil_moisture !== null ||
          point.temperature !== null ||
          point.humidity !== null
      ),
    [history]
  );

  const sendMode = async (mode) => {
    setBusy(true);
    setNotice("");

    try {
      const response = await fetch(`${API_BASE}/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Mode command failed.");
      }

      setNotice(
        `Mode command sent: ${mode}. Waiting for fresh Uno confirmation.`
      );

      await readData();
    } catch (err) {
      setNotice(err.message || "Could not send the mode command.");
    } finally {
      setBusy(false);
    }
  };

  const sendPump = async (pump) => {
    if (data?.mode !== "MANUAL") {
      setNotice("Switch to MANUAL mode before controlling the pump.");
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const response = await fetch(`${API_BASE}/api/pump`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pump }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || "Pump command failed.");
      }

      setNotice(
        `Pump ${pump ? "ON" : "OFF"} command sent. Waiting for sensor confirmation.`
      );

      await readData();
    } catch (err) {
      setNotice(err.message || "Could not send the pump command.");
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (name) => {
    setSelectedPreset(name);
    setThreshold(PRESETS[name].threshold);

    setNotice(
      `${name} preset selected. Its ${PRESETS[name].threshold}% threshold is currently saved in this page only; the existing API does not yet send threshold changes to the Uno.`
    );
  };

  const exportHistory = () => {
    if (!history.length) {
      setNotice("There is no sensor history to export yet.");
      return;
    }

    const csvRows = [
      [
        "timestamp",
        "soil_moisture_percent",
        "temperature_c",
        "humidity_percent",
      ],
      ...history.map((point) => [
        new Date(point.time).toISOString(),
        point.soil_moisture ?? "",
        point.temperature ?? "",
        point.humidity ?? "",
      ]),
    ];

    const csv = csvRows
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "agri-tek-session-history.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setNotice("Session history exported as CSV.");
  };

  const clearHistory = () => {
    setHistory([]);
    setNotice("Session history cleared.");
  };

  const navItems = [
    { name: "Overview", icon: "leaf" },
    { name: "Live Data", icon: "chart" },
    { name: "Pump Control", icon: "pump" },
    { name: "Presets", icon: "water" },
    { name: "History", icon: "clock" },
    { name: "Settings", icon: "settings" },
  ];

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="plant" />
          </div>

          <div>
            <h1>Agri-Tek</h1>
            <p>SMART IRRIGATION</p>
          </div>
        </div>

        <div className="side-caption">WORKSPACE</div>

        <nav className="nav-list" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${page === item.name ? "active" : ""}`}
              onClick={() => setPage(item.name)}
            >
              <Icon name={item.icon} />
              <span>{item.name}</span>
              {page === item.name && <span className="nav-indicator" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className={`connection-card ${live ? "online" : "offline"}`}>
            <span className="status-dot" />

            <div>
              <strong>{live ? "System online" : "Connection issue"}</strong>
              <small>
                {live
                  ? "Receiving sensor data"
                  : "Check Flask / ESP32 / Uno"}
              </small>
            </div>
          </div>

          <p className="sidebar-foot">Agri-Tek · Sensor Core</p>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">SMART FARMING / CONTROL CENTER</p>
            <h2>{page}</h2>
          </div>

          <div className={`top-status ${live ? "good" : "bad"}`}>
            <span className="status-dot" />
            {live ? "LIVE" : "OFFLINE"}
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={() =>
              setTheme((current) =>
                current === "light" ? "dark" : "light"
              )
            }
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            aria-pressed={theme === "dark"}
            title="Toggle theme"
          >
            {theme === "light" ? "☾ Dark mode" : "☀ Light mode"}
          </button>
        </header>

        {error && (
          <div className="alert alert-error" role="alert">
            <strong>Connection warning</strong>
            <span>{error}</span>
            <button className="text-button" onClick={readData}>
              Retry
            </button>
          </div>
        )}

        {notice && (
          <div className="alert alert-info" role="status">
            <span>{notice}</span>
            <button
              className="alert-close"
              onClick={() => setNotice("")}
              aria-label="Dismiss notice"
            >
              ×
            </button>
          </div>
        )}

        {page === "Overview" && (
          <>
            <section className="welcome-row">
              <div>
                <p className="eyebrow">YOUR GROWING SPACE</p>
                <h3>
                  Plant health at a glance<span>.</span>
                </h3>
                <p className="muted">
                  {live
                    ? "Your dashboard is receiving readings from the irrigation system."
                    : "Showing the last available readings, if any. They may be outdated."}
                </p>
              </div>

              <button
                className="button button-secondary"
                onClick={readData}
                disabled={loading}
              >
                ↻ Refresh now
              </button>
            </section>

            <section className="metrics-grid">
              <MetricCard
                icon="leaf"
                label="Soil moisture"
                value={data?.soil_moisture}
                unit="%"
                note={
                  data?.soil_moisture == null
                    ? "No valid reading"
                    : data.soil_moisture < threshold
                      ? `Below selected ${threshold}% threshold`
                      : "At or above selected threshold"
                }
                tone="green"
              />

              <MetricCard
                icon="temp"
                label="Temperature"
                value={data?.temperature}
                unit="°C"
                note="Ambient temperature"
                tone="orange"
              />

              <MetricCard
                icon="humidity"
                label="Air humidity"
                value={data?.humidity}
                unit="%"
                note="Relative humidity"
                tone="blue"
              />

              <MetricCard
                icon="rain"
                label="Rain sensor"
                value={
                  data?.rain === null || data?.rain === undefined
                    ? "--"
                    : data.rain
                      ? "Wet"
                      : "Dry"
                }
                unit=""
                note={
                  data?.rain == null
                    ? "No valid reading"
                    : "Digital sensor state"
                }
                tone="purple"
              />
            </section>

            <section className="content-grid">
              <article className="panel panel-large">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">RECENT READINGS</p>
                    <h3>Sensor trends</h3>
                  </div>

                  <button
                    className="text-button"
                    onClick={() => setPage("Live Data")}
                  >
                    View charts →
                  </button>
                </div>

                <LineChart
                  points={chartPoints}
                  dataKey="soil_moisture"
                  color="#25865a"
                  label="Soil moisture"
                  unit="%"
                />
              </article>

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">IRRIGATION</p>
                    <h3>System status</h3>
                  </div>

                  <span className={`pill ${live ? "pill-good" : "pill-bad"}`}>
                    {live ? "Connected" : "Offline"}
                  </span>
                </div>

                <div className="status-list">
                  <div>
                    <span>Operating mode</span>
                    <strong>{data?.mode || "--"}</strong>
                  </div>
                  <div>
                    <span>Pump state</span>
                    <strong>
                      {data?.pump == null
                        ? "--"
                        : data.pump
                          ? "ON"
                          : "OFF"}
                    </strong>
                  </div>
                  <div>
                    <span>Last successful read</span>
                    <strong>{lastSuccess ? formatTime(lastSuccess) : "Never"}</strong>
                  </div>
                  <div>
                    <span>Selected preset</span>
                    <strong>{selectedPreset}</strong>
                  </div>
                  <div>
                    <span>Local threshold</span>
                    <strong>{threshold}%</strong>
                  </div>
                </div>

                <button
                  className="button button-primary full-width"
                  onClick={() => setPage("Pump Control")}
                >
                  Open pump controls
                </button>
              </article>
            </section>

            <p className="disclaimer">
              The selected threshold is currently a dashboard setting only. It
              does not change the Uno's automatic irrigation logic.
            </p>
          </>
        )}

        {page === "Live Data" && (
          <>
            <section className="page-intro">
              <p className="eyebrow">TELEMETRY</p>
              <h3>Live sensor data</h3>
              <p className="muted">
                Charts use readings collected while this page is open.
              </p>
            </section>

            <section className="charts-grid">
              <article className="panel">
                <LineChart
                  points={chartPoints}
                  dataKey="soil_moisture"
                  color="#25865a"
                  label="Soil moisture"
                  unit="%"
                />
              </article>

              <article className="panel">
                <LineChart
                  points={chartPoints}
                  dataKey="temperature"
                  color="#df8741"
                  label="Temperature"
                  unit="°C"
                />
              </article>

              <article className="panel">
                <LineChart
                  points={chartPoints}
                  dataKey="humidity"
                  color="#4387c5"
                  label="Air humidity"
                  unit="%"
                />
              </article>
            </section>

            <div className="panel data-table-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">LATEST SAMPLE</p>
                  <h3>Current values</h3>
                </div>

                <span className={`pill ${live ? "pill-good" : "pill-bad"}`}>
                  {live ? "Fresh" : "Stale / unavailable"}
                </span>
              </div>

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Measurement</th>
                      <th>Value</th>
                      <th>Unit / state</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td>Soil moisture</td>
                      <td>{formatValue(data?.soil_moisture)}</td>
                      <td>%</td>
                    </tr>
                    <tr>
                      <td>Temperature</td>
                      <td>{formatValue(data?.temperature)}</td>
                      <td>°C</td>
                    </tr>
                    <tr>
                      <td>Air humidity</td>
                      <td>{formatValue(data?.humidity)}</td>
                      <td>%</td>
                    </tr>
                    <tr>
                      <td>Rain sensor</td>
                      <td>
                        {data?.rain == null
                          ? "--"
                          : data.rain
                            ? "Wet"
                            : "Dry"}
                      </td>
                      <td>Digital</td>
                    </tr>
                    <tr>
                      <td>Pump</td>
                      <td>
                        {data?.pump == null
                          ? "--"
                          : data.pump
                            ? "ON"
                            : "OFF"}
                      </td>
                      <td>Feedback from Uno</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {page === "Pump Control" && (
          <>
            <section className="page-intro">
              <p className="eyebrow">DEVICE MANAGEMENT</p>
              <h3>Pump & mode control</h3>
              <p className="muted">
                Commands are sent through Flask to the ESP32 and then to the
                Uno.
              </p>
            </section>

            <section className="control-grid">
              <article className="panel">
                <p className="eyebrow">OPERATING MODE</p>
                <h3>Choose how irrigation is managed</h3>

                <div className="mode-options">
                  {["AUTO", "MANUAL"].map((mode) => (
                    <button
                      key={mode}
                      className={`mode-option ${
                        data?.mode === mode ? "selected" : ""
                      }`}
                      onClick={() => sendMode(mode)}
                      disabled={busy || !live}
                    >
                      <strong>{mode}</strong>
                      <span>
                        {mode === "AUTO"
                          ? "Uno manages the pump"
                          : "You send pump commands"}
                      </span>
                    </button>
                  ))}
                </div>

                <p className="muted small">
                  Automatic operation depends on the logic programmed into
                  your Arduino Uno.
                </p>
              </article>

              <article className="panel pump-panel">
                <p className="eyebrow">PUMP OUTPUT</p>

                <div className={`pump-graphic ${data?.pump ? "running" : ""}`}>
                  ◉
                </div>

                <h3>
                  {data?.pump == null
                    ? "State unknown"
                    : data.pump
                      ? "Pump reported ON"
                      : "Pump reported OFF"}
                </h3>

                <p className="muted">
                  {data?.mode === "MANUAL"
                    ? "Manual control is selected."
                    : "Switch to MANUAL mode to enable the controls."}
                </p>

                <div className="pump-buttons">
                  <button
                    className="button button-primary"
                    onClick={() => sendPump(true)}
                    disabled={
                      busy ||
                      !live ||
                      data?.mode !== "MANUAL" ||
                      data?.pump === true
                    }
                  >
                    Turn pump on
                  </button>

                  <button
                    className="button button-danger"
                    onClick={() => sendPump(false)}
                    disabled={
                      busy ||
                      !live ||
                      data?.mode !== "MANUAL" ||
                      data?.pump === false
                    }
                  >
                    Turn pump off
                  </button>
                </div>

                <p className="disclaimer">
                  A successful HTTP response confirms command delivery, not
                  necessarily physical pump operation. Verify the reported
                  state.
                </p>
              </article>
            </section>
          </>
        )}

        {page === "Presets" && (
          <>
            <section className="page-intro">
              <p className="eyebrow">IRRIGATION PROFILE</p>
              <h3>Presets & moisture threshold</h3>
              <p className="muted">
                Choose a profile to set the threshold used by this dashboard.
              </p>
            </section>

            <section className="preset-grid">
              {Object.entries(PRESETS).map(([name, preset]) => (
                <button
                  key={name}
                  className={`preset-card ${
                    selectedPreset === name ? "chosen" : ""
                  }`}
                  onClick={() => applyPreset(name)}
                >
                  <span className="preset-symbol">
                    {name === "Water Saver"
                      ? "♻"
                      : name === "Thirsty Plants"
                        ? "💧"
                        : "🌿"}
                  </span>

                  <span className="preset-title">{name}</span>
                  <strong>{preset.threshold}%</strong>
                  <span className="muted">{preset.description}</span>
                  <span className="preset-select">
                    {selectedPreset === name
                      ? "Selected ✓"
                      : "Select preset →"}
                  </span>
                </button>
              ))}
            </section>

            <article className="panel threshold-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">CUSTOM VALUE</p>
                  <h3>Soil moisture threshold</h3>
                </div>

                <strong className="threshold-number">{threshold}%</strong>
              </div>

              <label className="range-label" htmlFor="threshold">
                Threshold: {threshold}%
              </label>

              <input
                id="threshold"
                className="range-input"
                type="range"
                min="0"
                max="90"
                step="1"
                value={threshold}
                onChange={(event) => {
                  setThreshold(Number(event.target.value));
                  setSelectedPreset("Custom");
                }}
              />

              <div className="range-ends">
                <span>0% · Drier</span>
                <span>90% · Wetter</span>
              </div>

              <div className="threshold-preview">
                <span>Current soil moisture</span>
                <strong>{formatValue(data?.soil_moisture, "%")}</strong>
                <span>
                  {data?.soil_moisture == null
                    ? "Waiting for a reading"
                    : data.soil_moisture < threshold
                      ? "Below your selected threshold"
                      : "At or above your selected threshold"}
                </span>
              </div>

              <div className="alert alert-info">
                This threshold currently affects the dashboard preview only.
                Your current Flask API has no threshold route, so it is not
                sent to the Uno or saved to hardware.
              </div>
            </article>
          </>
        )}

        {page === "History" && (
          <>
            <section className="page-intro">
              <p className="eyebrow">RECORDED TELEMETRY</p>
              <h3>Session history</h3>
              <p className="muted">
                {history.length} samples collected in this browser session.
                History is temporary and resets when the page reloads.
              </p>
            </section>

            <div className="history-actions">
              <button className="button button-secondary" onClick={exportHistory}>
                Export CSV
              </button>
              <button
                className="button button-danger-outline"
                onClick={clearHistory}
              >
                Clear history
              </button>
            </div>

            <section className="charts-grid">
              <article className="panel">
                <LineChart
                  points={chartPoints}
                  dataKey="soil_moisture"
                  color="#25865a"
                  label="Soil moisture"
                  unit="%"
                />
              </article>

              <article className="panel">
                <LineChart
                  points={chartPoints}
                  dataKey="temperature"
                  color="#df8741"
                  label="Temperature"
                  unit="°C"
                />
              </article>
            </section>

            <div className="panel data-table-panel">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Soil moisture</th>
                      <th>Temperature</th>
                      <th>Humidity</th>
                    </tr>
                  </thead>

                  <tbody>
                    {[...history].reverse().slice(0, 100).map((point, index) => (
                      <tr key={`${point.time}-${index}`}>
                        <td>{new Date(point.time).toLocaleString()}</td>
                        <td>{formatValue(point.soil_moisture, "%")}</td>
                        <td>{formatValue(point.temperature, "°C")}</td>
                        <td>{formatValue(point.humidity, "%")}</td>
                      </tr>
                    ))}

                    {!history.length && (
                      <tr>
                        <td colSpan="4" className="empty-cell">
                          No readings collected yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {page === "Settings" && (
          <>
            <section className="page-intro">
              <p className="eyebrow">PREFERENCES</p>
              <h3>Dashboard settings</h3>
              <p className="muted">
                These preferences affect the React dashboard only.
              </p>
            </section>

            <article className="panel settings-panel">
              <div className="setting-row">
                <div>
                  <strong>Data refresh interval</strong>
                  <p className="muted">
                    How often the dashboard requests readings.
                  </p>
                </div>

                <select
                  value={settings.refreshSeconds}
                  onChange={(event) =>
                    setSettings((old) => ({
                      ...old,
                      refreshSeconds: Number(event.target.value),
                    }))
                  }
                >
                  <option value="2">2 seconds</option>
                  <option value="5">5 seconds</option>
                  <option value="10">10 seconds</option>
                </select>
              </div>

              <div className="setting-row">
                <div>
                  <strong>History window</strong>
                  <p className="muted">
                    Older session samples are removed automatically.
                  </p>
                </div>

                <select
                  value={settings.historyMinutes}
                  onChange={(event) =>
                    setSettings((old) => ({
                      ...old,
                      historyMinutes: Number(event.target.value),
                    }))
                  }
                >
                  <option value="10">Last 10 minutes</option>
                  <option value="30">Last 30 minutes</option>
                  <option value="60">Last 60 minutes</option>
                </select>
              </div>

              <div className="setting-row">
                <div>
                  <strong>Flask API address</strong>
                  <p className="muted">
                    Current configured API endpoint.
                  </p>
                </div>

                <code>{API_BASE}</code>
              </div>

              <div className="setting-row">
                <div>
                  <strong>Theme</strong>
                  <p className="muted">
                    Your selection is saved in this browser.
                  </p>
                </div>

                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() =>
                    setTheme((current) =>
                      current === "light" ? "dark" : "light"
                    )
                  }
                >
                  {theme === "light" ? "Enable dark mode" : "Enable light mode"}
                </button>
              </div>

              <div className="setting-row">
                <div>
                  <strong>Connection state</strong>
                  <p className="muted">
                    Based on recent successful API readings.
                  </p>
                </div>

                <span className={`pill ${live ? "pill-good" : "pill-bad"}`}>
                  {live ? "Connected" : "Not connected"}
                </span>
              </div>

              <div className="setting-row">
                <div>
                  <strong>Last attempt</strong>
                  <p className="muted">
                    Most recent dashboard polling attempt.
                  </p>
                </div>

                <span>{lastAttempt ? formatTime(lastAttempt) : "Not started"}</span>
              </div>

              <button className="button button-primary" onClick={readData}>
                Test connection now
              </button>
            </article>

            <p className="disclaimer">
              Refresh and history preferences currently live in React state;
              they are not persisted across page reloads.
            </p>
          </>
        )}

        <footer className="footer">
          <span>© {new Date().getFullYear()} Agri-Tek</span>
          <span>Smart irrigation · Built for your growing space</span>
        </footer>
      </main>
    </div>
  );
}
