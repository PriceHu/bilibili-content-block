// ==UserScript==
// @name         BiliBili Content Block
// @namespace    local.bilibili-content-block
// @version      1.0.0
// @description  Blur Bilibili content matched by configurable title and author regex entries.
// @match        https://*.bilibili.com/*
// @match        https://bilibili.com/*
// @match        http://*.bilibili.com/*
// @match        http://bilibili.com/*
// @exclude      *://*.bilibili.com/*/mobile.html
// @exclude      *://*.bilibili.com/api/*
// @exclude      *://api.bilibili.com/*
// @exclude      *://api.*.bilibili.com/*
// @exclude      *://live.bilibili.com/*
// @exclude      *://m.bilibili.com/*
// @exclude      *://mall.bilibili.com/*
// @exclude      *://message.bilibili.com/*
// @exclude      *://bbq.bilibili.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const DEBUG_PREFIX = '[BiliBili Content Block]';
    const warnedInvalidEntries = new Set();
    const runtimeState = {
        sourceLoadedAt: new Date().toISOString(),
        href: location.href,
        readyState: document.readyState
    };
    window.__BCB_STATE__ = runtimeState;

    function reportError(message, error) {
        console.error(`${DEBUG_PREFIX} ${message}`, error);
    }

    window.addEventListener('error', (event) => {
        const stack = String(event.error && event.error.stack || event.filename || '');
        if (stack.includes('bilibili-content-blur')) reportError('runtime error', event.error || event.message);
    });

    const STORAGE_KEY = 'bilibili-content-blur:v2';
    const DEFAULT_VERTICAL = 38;

    const TARGET_RULES = [
        {
            item: '.bili-video-card',
            title: '.bili-video-card__info--tit a, .bili-video-card__info--tit, .bili-video-card__title',
            media: '.bili-video-card__cover img, .bili-video-card__image--wrap img',
            user: '.bili-video-card__info--author, .bili-video-card__info--author-name'
        },
        {
            item: '.video-page-card-small',
            title: '.title',
            media: '.pic-box .b-img',
            user: '.upname'
        },
        {
            item: '.bpx-player-ending-related-item',
            title: '.bpx-player-ending-related-item-title',
            media: '.bpx-player-ending-related-item-img',
            user: ''
        },
        {
            item: '.video-card',
            title: '.title, .description, .video-name, .video-card__title',
            media: '.cover-container .cover, .cover-picture__image, .video-card__cover',
            user: '.up .name, .up-name__text, .video-card__author'
        },
        {
            item: '.bili-dyn-list__item, .list__topic-card',
            title: '.bili-dyn-content__orig__desc, .bili-dyn-card-video__title, .bili-dyn-card-video__desc, .bili-dyn-content__forw__desc, .dyn-card-opus__summary',
            media: '.bili-album__preview__picture .b-img__inner, .b-img, .bili-dyn-card-video__cover',
            user: '.bili-dyn-title__text, .bili-dyn-item__header .bili-dyn-title__text'
        },
        {
            item: '.top-video',
            title: '.top-video__title',
            media: '.top-video__cover',
            user: '.upinfo__main .nickname'
        },
        {
            item: '.interaction-item',
            title: '.interaction-item__msg',
            media: '.interaction-item__cover',
            user: '.interaction-item__uname'
        }
    ];

    const BLOCK_TYPE_META = {
        titlePatterns: {
            title: 'Title Patterns',
            description: 'Match video and post text'
        },
        blockedUsers: {
            title: 'Blocked Authors',
            description: 'Match author names'
        },
        allowedUsers: {
            title: 'Allowed Authors',
            description: 'Override other blocks'
        }
    };

    const ICONS = {
        eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.2 12s3.5-6 9.8-6 9.8 6 9.8 6-3.5 6-9.8 6-9.8-6-9.8-6Z"></path><circle cx="12" cy="12" r="2.6"></circle></svg>',
        close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>',
        back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7M8 12h11"></path></svg>',
        forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7M16 12H5"></path></svg>',
        plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
        trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6m4-6v6M9 7l.7-2h4.6l.7 2m-8.5 0 .7 13h9.6l.7-13"></path></svg>',
    };

    let config;
    let panel;
    let toggleButton;
    let scanQueued = false;
    let activeListName = null;
    let appliedBlur = new Map();
    const listFilters = Object.create(null);

    function entry(source, enabled = true) {
        return { source, enabled };
    }

    function createFreshConfig() {
        return {
            titlePatterns: [],
            blockedUsers: [],
            allowedUsers: [],
            side: 'right',
            vertical: DEFAULT_VERTICAL,
            theme: 'light'
        };
    }

    function stripRegexLiteral(value) {
        const text = String(value || '').trim();
        const match = text.match(/^\/([\s\S]*)\/([a-z]*)$/i);
        return match ? match[1] : text;
    }

    function normalizeEntries(entries) {
        if (!Array.isArray(entries)) return [];
        return entries
            .map((item) => {
                if (typeof item === 'string') return entry(stripRegexLiteral(item));
                if (!item || typeof item.source !== 'string') return null;
                return entry(stripRegexLiteral(item.source), item.enabled !== false);
            })
            .filter((item) => item && item.source.length > 0);
    }

    function normalizeConfig(value) {
        const freshConfig = createFreshConfig();
        return {
            titlePatterns: normalizeEntries(value && value.titlePatterns),
            blockedUsers: normalizeEntries(value && value.blockedUsers),
            allowedUsers: normalizeEntries(value && value.allowedUsers),
            side: value && value.side === 'left' ? 'left' : 'right',
            vertical: Math.min(92, Math.max(8, Number(value && value.vertical) || freshConfig.vertical)),
            theme: value && value.theme === 'dark' ? 'dark' : 'light'
        };
    }

    function loadConfig() {
        const stored = GM_getValue(STORAGE_KEY, null);
        if (stored && typeof stored === 'object') {
            return normalizeConfig(stored);
        }

        const initial = createFreshConfig();
        GM_setValue(STORAGE_KEY, initial);
        return initial;
    }

    function saveConfig() {
        GM_setValue(STORAGE_KEY, config);
    }

    function compileEntries(entries, listName) {
        return entries
            .filter((item) => item.enabled && item.source)
            .map((item) => {
                try {
                    item.invalid = false;
                    return new RegExp(item.source, 'iu');
                } catch (error) {
                    item.invalid = true;
                    const warningKey = `${listName}:${item.source}`;
                    if (!warnedInvalidEntries.has(warningKey)) {
                        warnedInvalidEntries.add(warningKey);
                        console.warn(`${DEBUG_PREFIX} invalid regex in ${listName}: ${item.source}`, error.message);
                    }
                    return null;
                }
            })
            .filter(Boolean);
    }

    function matchesAny(text, expressions) {
        return expressions.some((expression) => expression.test(text));
    }

    function textFrom(elements) {
        return [...new Set(elements)]
            .map((element) => element.textContent.trim())
            .filter(Boolean)
            .join(' ');
    }

    function descendants(item, selector) {
        if (!selector) return [];
        return [...item.querySelectorAll(selector)];
    }

    function queueScan() {
        if (scanQueued) return;
        scanQueued = true;
        window.setTimeout(() => {
            scanQueued = false;
            scanPage();
        }, 120);
    }

    function scanPage() {
        const titleExpressions = compileEntries(config.titlePatterns, 'titlePatterns');
        const blockedUserExpressions = compileEntries(config.blockedUsers, 'blockedUsers');
        const allowedUserExpressions = compileEntries(config.allowedUsers, 'allowedUsers');
        const candidates = new Map();
        const desiredBlur = new Map();

        for (const rule of TARGET_RULES) {
            document.querySelectorAll(rule.item).forEach((item) => {
                if (!candidates.has(item)) candidates.set(item, { titles: [], media: [], users: [] });
                const candidate = candidates.get(item);
                candidate.titles.push(...descendants(item, rule.title));
                candidate.media.push(...descendants(item, rule.media));
                candidate.users.push(...descendants(item, rule.user));
            });
        }

        let blockedCount = 0;
        for (const [item, candidate] of candidates) {
            const titleText = textFrom(candidate.titles);
            let userText = textFrom(candidate.users);
            if (!userText && item.closest('.space-main')) {
                userText = textFrom(document.querySelectorAll('.space-main .upinfo__main .nickname'));
            }

            const isAllowed = matchesAny(userText, allowedUserExpressions);
            const isBlocked = !isAllowed && (matchesAny(titleText, titleExpressions) || matchesAny(userText, blockedUserExpressions));
            if (!isBlocked) continue;

            blockedCount += 1;
            const titleTargets = [...new Set(candidate.titles)];
            const mediaTargets = [...new Set(candidate.media)];
            titleTargets.forEach((element) => markBlurTarget(desiredBlur, element, 'title'));
            mediaTargets.forEach((element) => markBlurTarget(desiredBlur, element, 'media'));
            if (!titleTargets.length && !mediaTargets.length) {
                markBlurTarget(desiredBlur, item, 'fallback');
            }
        }

        updateBlurredElements(desiredBlur);

        const countElement = document.querySelector('#bcb-count');
        if (countElement && countElement.textContent !== String(blockedCount)) {
            countElement.textContent = String(blockedCount);
        }

        runtimeState.lastScan = {
            candidates: candidates.size,
            blocked: blockedCount,
            enabledTitleEntries: config.titlePatterns.filter((item) => item.enabled).length,
            enabledBlockedUserEntries: config.blockedUsers.filter((item) => item.enabled).length,
            enabledAllowedUserEntries: config.allowedUsers.filter((item) => item.enabled).length,
            invalidEntries: [...config.titlePatterns, ...config.blockedUsers, ...config.allowedUsers]
                .filter((item) => item.invalid).length
        };
    }

    function markBlurTarget(targets, element, type) {
        if (!targets.has(element)) targets.set(element, new Set());
        targets.get(element).add(type);
    }

    function sameBlurTypes(first, second) {
        if (!first || !second || first.size !== second.size) return false;
        return [...first].every((type) => second.has(type));
    }

    function hasBlurClasses(element, types) {
        return element.classList.contains('bcb-blurred')
            && element.classList.contains('bcb-blurred-title') === types.has('title')
            && element.classList.contains('bcb-blurred-media') === types.has('media')
            && element.classList.contains('bcb-blurred-fallback') === types.has('fallback');
    }

    function updateBlurredElements(desiredBlur) {
        for (const [element, types] of appliedBlur) {
            if (desiredBlur.has(element)) continue;
            element.classList.remove('bcb-blurred', 'bcb-blurred-title', 'bcb-blurred-media', 'bcb-blurred-fallback');
            appliedBlur.delete(element);
        }

        for (const [element, types] of desiredBlur) {
            if (appliedBlur.has(element)
                && sameBlurTypes(appliedBlur.get(element), types)
                && hasBlurClasses(element, types)) continue;
            element.classList.remove('bcb-blurred', 'bcb-blurred-title', 'bcb-blurred-media', 'bcb-blurred-fallback');
            element.classList.add('bcb-blurred');
            if (types.has('title')) element.classList.add('bcb-blurred-title');
            if (types.has('media')) element.classList.add('bcb-blurred-media');
            if (types.has('fallback')) element.classList.add('bcb-blurred-fallback');
            appliedBlur.set(element, types);
        }
    }

    function createElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function renderPatternList(listName, includeHeading = true) {
        const metadata = BLOCK_TYPE_META[listName];
        const section = createElement('section', 'bcb-list-section');
        let entryCount;
        if (includeHeading) {
            const header = createElement('div', 'bcb-section-heading');
            header.append(createElement('div', 'bcb-section-title', metadata.title));
            const sectionMeta = createElement('div', 'bcb-section-meta');
            sectionMeta.append(createElement('div', 'bcb-section-description', metadata.description));
            entryCount = createElement('div', 'bcb-entry-count');
            entryCount.dataset.role = 'entry-count';
            sectionMeta.append(entryCount);
            header.append(sectionMeta);
            section.append(header);
        }

        const filterRow = createElement('div', 'bcb-filter-row');
        const filterInput = document.createElement('input');
        filterInput.type = 'search';
        filterInput.value = listFilters[listName] || '';
        filterInput.placeholder = 'Filter entries';
        filterInput.dataset.action = 'filter-entries';
        filterInput.dataset.list = listName;
        filterInput.setAttribute('aria-label', `Filter ${metadata.title}`);
        filterRow.append(filterInput);
        section.append(filterRow);

        const filterQuery = (listFilters[listName] || '').trim().toLocaleLowerCase();
        const matchingEntries = config[listName]
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => !filterQuery || item.source.toLocaleLowerCase().includes(filterQuery));
        const list = createElement('div', 'bcb-entry-list');
        matchingEntries.forEach(({ item, index }) => {
            const row = createElement('div', 'bcb-entry-row');
            row.dataset.entrySource = item.source;
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = item.enabled;
            checkbox.dataset.action = 'toggle-entry';
            checkbox.dataset.list = listName;
            checkbox.dataset.index = String(index);
            checkbox.title = 'Enable entry';
            row.append(checkbox);

            const input = document.createElement('input');
            input.type = 'text';
            input.value = item.source;
            input.dataset.action = 'edit-entry';
            input.dataset.list = listName;
            input.dataset.index = String(index);
            input.className = item.invalid ? 'bcb-invalid' : '';
            input.setAttribute('aria-label', `${metadata.title} regex ${index + 1}`);
            row.append(input);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'bcb-icon-button bcb-remove-entry';
            remove.dataset.action = 'remove-entry';
            remove.dataset.list = listName;
            remove.dataset.index = String(index);
            remove.title = 'Remove entry';
            remove.setAttribute('aria-label', 'Remove entry');
            remove.innerHTML = ICONS.trash;
            row.append(remove);
            list.append(row);
        });
        if (!matchingEntries.length) {
            list.append(createElement('div', 'bcb-empty-list', config[listName].length ? 'No matching entries' : 'No entries yet'));
        }
        section.append(list);
        if (entryCount) entryCount.textContent = `${matchingEntries.length} / ${config[listName].length}`;

        const addRow = createElement('form', 'bcb-add-row');
        addRow.dataset.action = 'add-entry';
        addRow.dataset.list = listName;
        const addInput = document.createElement('input');
        addInput.type = 'text';
        addInput.placeholder = 'Add a regex';
        addInput.setAttribute('aria-label', `Add ${metadata.title} regex`);
        addRow.append(addInput);
        const addButton = document.createElement('button');
        addButton.type = 'submit';
        addButton.className = 'bcb-icon-button bcb-add-entry';
        addButton.title = 'Add entry';
        addButton.setAttribute('aria-label', 'Add entry');
        addButton.innerHTML = ICONS.plus;
        addRow.append(addButton);
        section.append(addRow);
        return section;
    }

    function renderHome() {
        const listContainer = document.querySelector('#bcb-list-links');
        if (!listContainer) return;
        listContainer.replaceChildren(...Object.entries(BLOCK_TYPE_META).map(([listName, metadata]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'bcb-list-link';
            button.dataset.action = 'open-list';
            button.dataset.list = listName;
            button.setAttribute('aria-label', `Manage ${metadata.title}`);

            const text = createElement('span', 'bcb-list-link-text');
            text.append(createElement('strong', 'bcb-list-link-title', metadata.title));
            text.append(createElement('span', 'bcb-list-link-description', metadata.description));
            button.append(text);

            const count = createElement('span', 'bcb-list-link-count');
            const enabledCount = config[listName].filter((item) => item.enabled).length;
            count.textContent = `${enabledCount} active / ${config[listName].length}`;
            button.append(count);
            button.insertAdjacentHTML('beforeend', ICONS.forward);
            return button;
        }));

        const countElement = document.querySelector('#bcb-count');
        if (countElement) countElement.textContent = countElement.textContent || '0';
        document.querySelector('#bcb-side-left').checked = config.side === 'left';
        document.querySelector('#bcb-side-right').checked = config.side === 'right';
        document.querySelector('#bcb-theme-light').checked = config.theme === 'light';
        document.querySelector('#bcb-theme-dark').checked = config.theme === 'dark';
        const range = document.querySelector('#bcb-vertical');
        range.value = String(config.vertical);
        document.querySelector('#bcb-vertical-value').textContent = `${config.vertical}%`;
        document.querySelector('#bcb-shell').dataset.side = config.side;
        document.querySelector('#bcb-shell').dataset.theme = config.theme;
    }

    function renderManagement() {
        const metadata = BLOCK_TYPE_META[activeListName];
        const content = document.querySelector('#bcb-management-content');
        if (!metadata || !content) return;
        document.querySelector('#bcb-management-title').textContent = metadata.title;
        document.querySelector('#bcb-management-description').textContent = metadata.description;
        document.querySelector('#bcb-management-count').textContent = `${config[activeListName].length} total`;
        content.replaceChildren(renderPatternList(activeListName, false));
    }

    function renderPanel() {
        const home = document.querySelector('#bcb-home-view');
        const management = document.querySelector('#bcb-management-view');
        if (!home || !management) return;
        home.hidden = Boolean(activeListName);
        management.hidden = !activeListName;
        if (activeListName) renderManagement();
        else renderHome();
    }

    function validSource(source) {
        try {
            new RegExp(source, 'iu');
            return true;
        } catch (error) {
            return false;
        }
    }

    function handlePanelChange(event) {
        const target = event.target;
        const listName = target.dataset.list;
        const index = Number(target.dataset.index);
        if (target.dataset.action === 'toggle-entry' && config[listName]?.[index]) {
            config[listName][index].enabled = target.checked;
            saveConfig();
            queueScan();
        }
        if (target.dataset.action === 'edit-entry' && config[listName]?.[index]) {
            const source = stripRegexLiteral(target.value.trim());
            config[listName][index].source = source;
            config[listName][index].invalid = !source || !validSource(source);
            target.classList.toggle('bcb-invalid', config[listName][index].invalid);
            saveConfig();
            queueScan();
        }
        if (target.id === 'bcb-side-left' || target.id === 'bcb-side-right') {
            config.side = target.value;
            saveConfig();
            document.querySelector('#bcb-shell').dataset.side = config.side;
        }
        if (target.id === 'bcb-theme-light' || target.id === 'bcb-theme-dark') {
            config.theme = target.value === 'dark' ? 'dark' : 'light';
            saveConfig();
            document.querySelector('#bcb-shell').dataset.theme = config.theme;
        }
    }

    function handlePanelInput(event) {
        if (event.target.dataset.action === 'filter-entries') {
            const input = event.target;
            const listName = input.dataset.list;
            listFilters[listName] = input.value;
            renderPanel();
            return;
        }
        if (event.target.id !== 'bcb-vertical') return;
        config.vertical = Number(event.target.value);
        document.querySelector('#bcb-vertical-value').textContent = `${config.vertical}%`;
        document.querySelector('#bcb-shell').style.setProperty('--bcb-vertical', `${config.vertical}%`);
        saveConfig();
    }

    function handlePanelClick(event) {
        const actionTarget = event.target.closest('[data-action]');
        if (!actionTarget) return;
        const action = actionTarget.dataset.action;
        if (action === 'close') {
            panel.hidden = true;
            toggleButton.setAttribute('aria-expanded', 'false');
        }
        if (action === 'open-list') {
            activeListName = actionTarget.dataset.list;
            renderPanel();
        }
        if (action === 'back-home') {
            activeListName = null;
            renderPanel();
        }
        if (action === 'remove-entry') {
            const list = config[actionTarget.dataset.list];
            list.splice(Number(actionTarget.dataset.index), 1);
            saveConfig();
            renderPanel();
            queueScan();
        }
    }

    function handleAdd(event) {
        const form = event.target.closest('form[data-action="add-entry"]');
        if (!form) return;
        event.preventDefault();
        const input = form.querySelector('input');
        const source = stripRegexLiteral(input.value.trim());
        if (!source || !validSource(source)) {
            input.classList.add('bcb-invalid');
            return;
        }
        config[form.dataset.list].push(entry(source));
        saveConfig();
        renderPanel();
        queueScan();
    }

    function createConsole() {
        const shell = createElement('div');
        shell.id = 'bcb-shell';
        shell.dataset.side = config.side;
        shell.dataset.theme = config.theme;
        shell.style.setProperty('--bcb-vertical', `${config.vertical}%`);
        shell.innerHTML = `
            <button id="bcb-toggle" type="button" aria-label="Open BiliBili Content Block settings" aria-expanded="false" title="BiliBili Content Block settings">
                ${ICONS.eye}<span>CONTENT BLOCKER</span>
            </button>
            <section id="bcb-panel" role="dialog" aria-labelledby="bcb-title" hidden>
                <header class="bcb-panel-header">
                    <div><div id="bcb-title">BiliBili Content Block</div><div class="bcb-panel-subtitle">BiliBili</div></div>
                    <button class="bcb-icon-button" type="button" data-action="close" title="Close" aria-label="Close">${ICONS.close}</button>
                </header>
                <div class="bcb-panel-content">
                    <div id="bcb-home-view">
                        <div class="bcb-status"><span><strong id="bcb-count">0</strong> blurred now</span><span>Start with your own rules</span></div>
                        <div id="bcb-list-links"></div>
                        <section class="bcb-settings">
                            <div class="bcb-section-heading"><div class="bcb-section-title">Button Position</div><div class="bcb-section-description">Keep it out of the way</div></div>
                            <div class="bcb-side-control" role="group" aria-label="Button edge">
                                <label><input id="bcb-side-left" type="radio" name="bcb-side" value="left"><span>Left edge</span></label>
                                <label><input id="bcb-side-right" type="radio" name="bcb-side" value="right"><span>Right edge</span></label>
                            </div>
                            <label class="bcb-range-label" for="bcb-vertical"><span>Vertical position</span><output id="bcb-vertical-value">${config.vertical}%</output></label>
                            <input id="bcb-vertical" type="range" min="8" max="92" step="1" value="${config.vertical}">
                            <div class="bcb-section-heading bcb-theme-heading"><div class="bcb-section-title">Theme</div></div>
                            <div class="bcb-side-control" role="group" aria-label="Theme">
                                <label><input id="bcb-theme-light" type="radio" name="bcb-theme" value="light"><span>Light+</span></label>
                                <label><input id="bcb-theme-dark" type="radio" name="bcb-theme" value="dark"><span>Dark+</span></label>
                            </div>
                        </section>
                    </div>
                    <div id="bcb-management-view" hidden>
                        <div class="bcb-management-header">
                            <button class="bcb-icon-button" type="button" data-action="back-home" title="Back to home" aria-label="Back to home">${ICONS.back}</button>
                            <div class="bcb-management-heading"><div id="bcb-management-title"></div><div id="bcb-management-description"></div></div>
                            <div id="bcb-management-count" class="bcb-management-count"></div>
                        </div>
                        <div id="bcb-management-content"></div>
                    </div>
                </div>
            </section>`;
        document.body.append(shell);
        toggleButton = shell.querySelector('#bcb-toggle');
        panel = shell.querySelector('#bcb-panel');
        toggleButton.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            toggleButton.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) renderPanel();
        });
        panel.addEventListener('click', handlePanelClick);
        panel.addEventListener('change', handlePanelChange);
        panel.addEventListener('input', handlePanelInput);
        panel.addEventListener('submit', handleAdd);
        renderPanel();
        runtimeState.consoleInjected = true;
        runtimeState.dom = {
            shellPresent: Boolean(document.querySelector('#bcb-shell')),
            buttonPresent: Boolean(toggleButton),
            panelPresent: Boolean(panel),
            panelHidden: panel.hidden
        };
    }

    function addStyles() {
        GM_addStyle(`
            .bcb-blurred {
                filter: blur(16px) !important;
                user-select: none !important;
            }
            .bcb-blurred-media {
                clip-path: inset(0);
            }
            .bcb-blurred-media:hover,
            .bcb-blurred-media:has(:hover),
            .bcb-blurred-media:hover .bcb-blurred-media,
            .bcb-blurred-media:has(:hover) .bcb-blurred-media {
                filter: none !important;
            }
            .bcb-blurred-title {
                filter: blur(8px) !important;
                // clip-path: inset(-6px -8px);
            }
            .bcb-blurred-fallback {
                clip-path: inset(0);
            }
            #bcb-shell, #bcb-shell * { box-sizing: border-box; }
            #bcb-shell {
                --bcb-ink: #3b3b3b;
                --bcb-muted: #6a737d;
                --bcb-line: #d4d4d4;
                --bcb-paper: #f3f3f3;
                --bcb-surface: #ffffff;
                --bcb-surface-hover: #e8e8e8;
                --bcb-header: #3b3b3b;
                --bcb-header-hover: #323232;
                --bcb-on-header: #ffffff;
                --bcb-subtitle: #d4d4d4;
                --bcb-accent: #007acc;
                --bcb-edge: rgba(0, 0, 0, .16);
                --bcb-shadow: rgba(0, 0, 0, .22);
                --bcb-focus: rgba(0, 122, 204, .24);
                --bcb-danger: #c72e2e;
                --bcb-danger-surface: #fdf0f0;
                --bcb-vertical: 38%;
                position: fixed;
                inset: 0;
                z-index: 99997;
                pointer-events: none;
                font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
                color: var(--bcb-ink);
                color-scheme: light;
            }
            #bcb-shell[data-theme="dark"] {
                --bcb-ink: #d4d4d4;
                --bcb-muted: #9d9d9d;
                --bcb-line: #3e3e42;
                --bcb-paper: #1e1e1e;
                --bcb-surface: #252526;
                --bcb-surface-hover: #2d2d30;
                --bcb-header: #252526;
                --bcb-header-hover: #333337;
                --bcb-on-header: #f3f3f3;
                --bcb-subtitle: #9cdcfe;
                --bcb-accent: #3794ff;
                --bcb-edge: rgba(255, 255, 255, .14);
                --bcb-shadow: rgba(0, 0, 0, .55);
                --bcb-focus: rgba(55, 148, 255, .28);
                --bcb-danger: #f14c4c;
                --bcb-danger-surface: #3a1d1d;
                color-scheme: dark;
            }
            #bcb-toggle {
                position: fixed;
                top: var(--bcb-vertical);
                transform: translateY(-50%);
                width: 36px;
                min-height: 86px;
                padding: 10px 8px;
                border: 1px solid var(--bcb-edge);
                background: var(--bcb-header);
                color: var(--bcb-on-header);
                cursor: pointer;
                pointer-events: auto;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 8px;
                box-shadow: 0 8px 20px var(--bcb-shadow);
                transition: width .18s ease, background .18s ease, box-shadow .18s ease;
            }
            #bcb-shell[data-side="right"] #bcb-toggle { right: 0; border-radius: 8px 0 0 8px; }
            #bcb-shell[data-side="left"] #bcb-toggle { left: 0; border-radius: 0 8px 8px 0; }
            #bcb-toggle:hover { width: 50px; background: var(--bcb-header-hover); box-shadow: 0 10px 26px var(--bcb-shadow); }
            #bcb-toggle svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
            #bcb-toggle span { font: 700 9px/1 "Segoe UI", sans-serif; letter-spacing: 0; writing-mode: vertical-rl; }
            #bcb-panel {
                position: fixed;
                top: 50%;
                transform: translateY(-50%);
                width: min(470px, calc(100vw - 28px));
                max-height: min(760px, calc(100vh - 28px));
                overflow: hidden;
                pointer-events: auto;
                background: var(--bcb-paper);
                border: 1px solid var(--bcb-edge);
                border-radius: 10px;
                box-shadow: 0 24px 60px var(--bcb-shadow);
            }
            #bcb-shell[data-side="right"] #bcb-panel { right: 58px; }
            #bcb-shell[data-side="left"] #bcb-panel { left: 58px; }
            .bcb-panel-header { padding: 18px 20px 16px; background: var(--bcb-header); color: var(--bcb-on-header); display: flex; align-items: center; justify-content: space-between; }
            #bcb-title { font-size: 19px; font-weight: 700; letter-spacing: 0; }
            .bcb-panel-subtitle { color: var(--bcb-subtitle); font-size: 11px; margin-top: 3px; }
            .bcb-panel-content { padding: 16px; max-height: calc(min(760px, 100vh - 28px) - 70px); overflow-y: auto; }
            .bcb-status { display: flex; align-items: center; justify-content: space-between; color: var(--bcb-muted); font-size: 12px; padding-bottom: 13px; border-bottom: 1px solid var(--bcb-line); }
            .bcb-status strong { color: var(--bcb-ink); font-size: 16px; }
            #bcb-list-links { display: grid; gap: 8px; padding: 15px 0; }
            .bcb-list-link { width: 100%; min-height: 58px; padding: 10px 11px 10px 13px; display: flex; align-items: center; gap: 10px; border: 1px solid var(--bcb-line); border-radius: 6px; background: var(--bcb-surface); color: var(--bcb-ink); text-align: left; cursor: pointer; }
            .bcb-list-link:hover { border-color: var(--bcb-accent); background: var(--bcb-surface-hover); }
            .bcb-list-link-text { min-width: 0; flex: 1; display: grid; gap: 3px; }
            .bcb-list-link-title { font-size: 13px; }
            .bcb-list-link-description { color: var(--bcb-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .bcb-list-link-count { color: var(--bcb-muted); font-size: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
            .bcb-list-link svg { width: 17px; height: 17px; flex: 0 0 17px; fill: none; stroke: var(--bcb-muted); stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
            .bcb-management-header { display: flex; align-items: center; gap: 9px; padding-bottom: 13px; border-bottom: 1px solid var(--bcb-line); }
            .bcb-management-heading { min-width: 0; flex: 1; display: grid; gap: 3px; }
            #bcb-management-title { font-size: 15px; font-weight: 700; }
            #bcb-management-description { color: var(--bcb-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .bcb-management-count { color: var(--bcb-accent); font-size: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
            #bcb-management-content .bcb-list-section { border-bottom: 0; padding-top: 13px; }
            .bcb-list-section, .bcb-settings { padding: 16px 0; border-bottom: 1px solid var(--bcb-line); }
            .bcb-section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
            .bcb-section-title { font-size: 14px; font-weight: 700; }
            .bcb-section-description { color: var(--bcb-muted); font-size: 11px; text-align: right; }
            .bcb-section-meta { display: flex; align-items: baseline; flex-direction: column; gap: 2px; }
            .bcb-entry-count { color: var(--bcb-accent); font-size: 10px; font-variant-numeric: tabular-nums; text-align: right; }
            .bcb-filter-row { margin-bottom: 7px; }
            .bcb-filter-row input { width: 100%; height: 29px; padding: 5px 8px; border: 1px solid var(--bcb-line); border-radius: 5px; color: var(--bcb-ink); background: var(--bcb-surface); font: 12px/1.2 "Segoe UI", "Microsoft YaHei", sans-serif; }
            .bcb-filter-row input:focus { outline: 2px solid var(--bcb-focus); border-color: var(--bcb-accent); }
            .bcb-entry-list { display: grid; gap: 6px; max-height: 220px; overflow-y: auto; padding: 1px 3px 1px 0; }
            .bcb-empty-list { padding: 10px 0; color: var(--bcb-muted); font-size: 12px; text-align: center; }
            .bcb-entry-row, .bcb-add-row { display: flex; gap: 7px; align-items: center; }
            .bcb-entry-row input[type="text"], .bcb-add-row input { min-width: 0; flex: 1; height: 31px; padding: 5px 8px; border: 1px solid var(--bcb-line); border-radius: 5px; color: var(--bcb-ink); background: var(--bcb-surface); font: 12px/1.2 Consolas, "Microsoft YaHei", monospace; }
            .bcb-entry-row input[type="text"]:focus, .bcb-add-row input:focus { outline: 2px solid var(--bcb-focus); border-color: var(--bcb-accent); }
            .bcb-entry-row input[type="text"].bcb-invalid, .bcb-add-row input.bcb-invalid { border-color: var(--bcb-danger); background: var(--bcb-danger-surface); }
            .bcb-entry-row input[type="checkbox"] { accent-color: var(--bcb-accent); width: 15px; height: 15px; flex: 0 0 15px; margin: 0; }
            .bcb-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--bcb-muted); cursor: pointer; flex: 0 0 30px; }
            .bcb-icon-button:hover { background: var(--bcb-surface-hover); color: var(--bcb-ink); }
            .bcb-remove-entry:hover { color: var(--bcb-danger); }
            .bcb-icon-button svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
            .bcb-add-row { margin-top: 8px; }
            .bcb-add-entry { border: 1px solid var(--bcb-line); background: var(--bcb-surface); color: var(--bcb-accent); }
            .bcb-add-entry:hover { border-color: var(--bcb-accent); background: var(--bcb-surface-hover); }
            .bcb-side-control { display: flex; gap: 8px; margin-bottom: 15px; }
            .bcb-side-control label { flex: 1; cursor: pointer; }
            .bcb-side-control input { position: absolute; opacity: 0; pointer-events: none; }
            .bcb-side-control span { display: block; border: 1px solid var(--bcb-line); border-radius: 5px; padding: 8px; text-align: center; color: var(--bcb-muted); font-size: 12px; background: var(--bcb-surface); }
            .bcb-side-control input:checked + span { color: var(--bcb-ink); border-color: var(--bcb-accent); box-shadow: inset 0 -2px 0 var(--bcb-accent); }
            .bcb-range-label { display: flex; justify-content: space-between; color: var(--bcb-muted); font-size: 12px; margin-bottom: 7px; }
            .bcb-range-label output { color: var(--bcb-ink); font-variant-numeric: tabular-nums; }
            #bcb-vertical { display: block; width: 100%; accent-color: var(--bcb-accent); cursor: pointer; }
            @media (max-width: 560px) {
                #bcb-shell[data-side="right"] #bcb-panel, #bcb-shell[data-side="left"] #bcb-panel { left: 14px; right: 14px; width: auto; }
                #bcb-panel { max-height: calc(100vh - 20px); }
                .bcb-panel-content { max-height: calc(100vh - 90px); }
                .bcb-section-heading { align-items: flex-start; flex-direction: column; gap: 3px; }
                .bcb-section-meta { align-items: flex-start; }
                .bcb-section-description { text-align: left; }
                .bcb-management-header { align-items: flex-start; }
                .bcb-management-count { padding-top: 2px; }
            }
        `);
        runtimeState.stylesAdded = true;
    }

    function observePage() {
        const observer = new MutationObserver((mutations) => {
            const pageChanged = mutations.some(({ target }) => {
                return target.nodeType !== 1 || !target.closest('#bcb-shell');
            });
            if (pageChanged) queueScan();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.setInterval(scanPage, 2500);
        window.addEventListener('popstate', queueScan);
        runtimeState.observerAttached = true;
    }

    function start() {
        if (document.querySelector('#bcb-shell')) {
            return;
        }
        try {
            config = loadConfig();
            addStyles();
            createConsole();
            scanPage();
            observePage();
            runtimeState.startedAt = new Date().toISOString();
            runtimeState.readyState = document.readyState;
            runtimeState.config = {
                titleEntries: config.titlePatterns.length,
                blockedUserEntries: config.blockedUsers.length,
                allowedUserEntries: config.allowedUsers.length,
                side: config.side,
                vertical: config.vertical,
                theme: config.theme
            };
            console.info(`${DEBUG_PREFIX} active`, {
                buttonPresent: Boolean(document.querySelector('#bcb-toggle')),
                candidates: runtimeState.lastScan.candidates,
                blocked: runtimeState.lastScan.blocked,
                entries: runtimeState.config
            });
        } catch (error) {
            reportError('start failed', error);
        }
    }

    if (document.body) start();
    else {
        runtimeState.waitingForBody = true;
        window.addEventListener('DOMContentLoaded', () => {
            start();
        }, { once: true });
    }
})();
