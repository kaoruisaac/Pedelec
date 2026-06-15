import { render } from "solid-js/web";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { EventMonitorApp } from "./event-monitor/EventMonitorApp.jsx";
import "./style.css";
import "./event-monitor/event-monitor.css";

const IS_DEV = import.meta.env.DEV;

const PAGES = {
  settings: "Settings",
  ...(IS_DEV ? { monitor: "Event Monitor" } : {}),
};

function AppShell() {
  const [page, setPage] = createSignal("settings");
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

  return (
    <div
      class="app-shell"
      classList={{
        "is-sidebar-collapsed": sidebarCollapsed(),
      }}
    >
      <aside class="app-sidebar" aria-label="Main menu">
        <div class="app-sidebar-header">
          <Show when={!sidebarCollapsed()}>
            <strong>Pedelec</strong>
          </Show>
          <button
            type="button"
            class="app-sidebar-toggle"
            aria-label={sidebarCollapsed() ? "Expand menu" : "Collapse menu"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed() ? ">" : "<"}
          </button>
        </div>
        <nav class="app-nav">
          <For each={Object.entries(PAGES)}>
            {([key, label]) => (
              <button
                type="button"
                class="app-nav-item"
                classList={{ "is-active": page() === key }}
                title={label}
                onClick={() => setPage(key)}
              >
                <span class="app-nav-icon" aria-hidden="true">
                  {key === "settings" ? "S" : "E"}
                </span>
                <Show when={!sidebarCollapsed()}>
                  <span>{label}</span>
                </Show>
              </button>
            )}
          </For>
        </nav>
      </aside>

      <section class="app-page">
        <div hidden={page() !== "settings"}>
          <SettingsPage />
        </div>
        <Show when={IS_DEV}>
          <div hidden={page() !== "monitor"}>
            <EventMonitorApp />
          </div>
        </Show>
      </section>
    </div>
  );
}

function SettingsPage() {
  const [settings, setSettings] = createSignal({
    defaultProvider: null,
    defaultModel: null,
  });
  const [providers, setProviders] = createSignal([]);
  const [selectedProvider, setSelectedProvider] = createSignal("");
  const [model, setModel] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const [savedMessage, setSavedMessage] = createSignal("");

  const selectedProviderInfo = createMemo(() =>
    providers().find((provider) => provider.code === selectedProvider()),
  );
  const savedProviderInfo = createMemo(() =>
    providers().find((provider) => provider.code === settings().defaultProvider),
  );
  const savedProviderUnavailable = createMemo(
    () => Boolean(settings().defaultProvider) && savedProviderInfo()?.available === false,
  );
  const canSave = createMemo(() => Boolean(selectedProviderInfo()?.available) && !saving());

  onMount(() => {
    loadSettings();
  });

  async function loadSettings() {
    setLoading(true);
    setError("");
    setSavedMessage("");
    try {
      const [nextSettings, nextProviders] = await Promise.all([
        invoke("get_settings"),
        invoke("list_providers"),
      ]);
      setSettings(nextSettings || { defaultProvider: null, defaultModel: null });
      setProviders(Array.isArray(nextProviders) ? nextProviders : []);
      setSelectedProvider(nextSettings?.defaultProvider || "");
      setModel(nextSettings?.defaultModel || "");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    setError("");
    setSavedMessage("");

    const provider = selectedProviderInfo();
    if (!provider?.available) {
      setError("Choose an available provider before saving.");
      return;
    }

    setSaving(true);
    try {
      const nextSettings = await invoke("update_settings", {
        input: {
          defaultProvider: provider.code,
          defaultModel: model().trim() || null,
        },
      });
      setSettings(nextSettings);
      setSelectedProvider(nextSettings.defaultProvider || "");
      setModel(nextSettings.defaultModel || "");
      setSavedMessage("Settings saved.");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main class="settings-page">
      <header class="settings-header">
        <div>
          <h1>Settings</h1>
          <p>Choose the default provider and optional model used by SDK sessions.</p>
        </div>
        <button type="button" class="settings-secondary-button" onClick={loadSettings} disabled={loading()}>
          Refresh
        </button>
      </header>

      <Show when={error()}>
        <div class="settings-alert is-error">{error()}</div>
      </Show>
      <Show when={savedMessage()}>
        <div class="settings-alert is-success">{savedMessage()}</div>
      </Show>
      <Show when={savedProviderUnavailable()}>
        <div class="settings-alert is-warning">
          Saved default provider "{settings().defaultProvider}" is currently unavailable. Choose an available provider before saving.
        </div>
      </Show>

      <form class="settings-panel" onSubmit={saveSettings}>
        <section class="settings-section">
          <div class="settings-section-heading">
            <h2>Default Provider</h2>
            <span>{loading() ? "Loading..." : `${providers().length} providers`}</span>
          </div>

          <div class="provider-list">
            <For each={providers()}>
              {(provider) => (
                <label
                  class="provider-option"
                  classList={{
                    "is-unavailable": !provider.available,
                    "is-selected": selectedProvider() === provider.code,
                  }}
                >
                  <input
                    type="radio"
                    name="defaultProvider"
                    value={provider.code}
                    checked={selectedProvider() === provider.code}
                    disabled={!provider.available}
                    onChange={() => setSelectedProvider(provider.code)}
                  />
                  <span class="provider-main">
                    <strong>{provider.name}</strong>
                    <span>{provider.code}</span>
                  </span>
                  <span class="provider-status" data-status={provider.available ? "available" : "unavailable"}>
                    {provider.available ? "Available" : "Unavailable"}
                  </span>
                  <Show when={provider.error}>
                    <span class="provider-error">{provider.error}</span>
                  </Show>
                </label>
              )}
            </For>
          </div>
        </section>

        <section class="settings-section">
          <label class="settings-field">
            <span>Default Model</span>
            <input
              type="text"
              value={model()}
              placeholder="Optional"
              onInput={(event) => setModel(event.currentTarget.value)}
            />
          </label>
        </section>

        <footer class="settings-actions">
          <button type="submit" class="settings-primary-button" disabled={!canSave()}>
            {saving() ? "Saving..." : "Save"}
          </button>
        </footer>
      </form>
    </main>
  );
}

function formatError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err.code && err.message) return `${err.code}: ${err.message}`;
  return err.message || JSON.stringify(err);
}

const dispose = render(() => <AppShell />, document.getElementById("root"));

if (import.meta.hot) {
  import.meta.hot.dispose(dispose);
}
