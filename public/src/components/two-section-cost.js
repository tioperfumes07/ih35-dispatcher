(function initIH35TwoSectionCost(global) {
  'use strict';

  var STYLE_ID = 'ih-two-section-cost-styles';
  var CATEGORY_OPTIONS = ['Detention', 'Toll', 'Lumper', 'Office', 'Other'];
  var ITEM_OPTIONS = [
    'Steer tire 295/75R22.5',
    'Drive tire 11R22.5',
    'Brake pad set',
    'Mount and balance labor',
    'Diagnostic labor',
    'DEF fluid',
    'Oil change service',
  ];

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.ih-two-section-cost{display:grid;gap:10px;color:var(--ih-text-primary);font-family:Arial,sans-serif}',
      '.ih-two-section-cost *{box-sizing:border-box}',
      '.ih-two-section-cost__head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border:1px solid var(--ih-border-light);border-left-width:3px}',
      '.ih-two-section-cost__head--a{background:var(--ih-section-a-bg);border-left-color:var(--ih-section-a-border)}',
      '.ih-two-section-cost__head--b{background:var(--ih-section-b-bg);border-left-color:var(--ih-section-b-border)}',
      '.ih-two-section-cost__title{font-size:9px;font-weight:500;letter-spacing:var(--ih-letter-label);text-transform:uppercase}',
      '.ih-two-section-cost__add{height:var(--ih-height-button);padding:0 10px;border:var(--ih-border-width) solid var(--ih-border-light);border-radius:var(--ih-radius);background:var(--ih-bg-card);font-size:var(--ih-font-button);cursor:pointer}',
      '.ih-two-section-cost__table{width:100%;border-collapse:collapse;background:var(--ih-bg-card)}',
      '.ih-two-section-cost__table th,.ih-two-section-cost__table td{border:var(--ih-border-width) solid var(--ih-border-divider);padding:var(--ih-padding-cell);font-size:var(--ih-font-content);vertical-align:middle}',
      '.ih-two-section-cost__table th{background:var(--ih-bg-section-header);text-align:left;font-size:var(--ih-font-label);letter-spacing:var(--ih-letter-label);text-transform:uppercase;color:var(--ih-text-label)}',
      '.ih-two-section-cost__table td.num,.ih-two-section-cost__table th.num{text-align:right}',
      '.ih-two-section-cost__input,.ih-two-section-cost__select{width:100%;height:var(--ih-height-field);border:var(--ih-border-width) solid var(--ih-border-light);border-radius:var(--ih-radius);padding:0 5px;font-size:var(--ih-font-content);background:var(--ih-bg-card);color:var(--ih-text-primary)}',
      '.ih-two-section-cost__line-total{display:inline-block;min-width:78px;text-align:right}',
      '.ih-two-section-cost__row-del{width:24px;height:var(--ih-height-field);border:var(--ih-border-width) solid var(--ih-border-light);border-radius:var(--ih-radius);background:var(--ih-bg-card);cursor:pointer;font-size:12px;line-height:1}',
      '.ih-two-section-cost__subtotal-row td{background:var(--ih-bg-input-faded);font-weight:500}',
      '.ih-two-section-cost__subtotal-label{text-align:right}',
      '.ih-two-section-cost__total{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--ih-navy);color:var(--ih-bg-card);padding:7px 10px;border-radius:var(--ih-radius)}',
      '.ih-two-section-cost__total-label{font-size:10px;font-weight:500;letter-spacing:var(--ih-letter-label);text-transform:uppercase}',
      '.ih-two-section-cost__total-value{font-size:13px;font-weight:700}',
    ].join('');
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function money(value) {
    var n = toNumber(value, 0);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function normalizeCategory(row) {
    var src = row && typeof row === 'object' ? row : {};
    return {
      category: String(src.category || '').trim(),
      description: String(src.description || '').trim(),
      amount: toNumber(src.amount, 0),
    };
  }

  function normalizeItem(row) {
    var src = row && typeof row === 'object' ? row : {};
    var qty = toNumber(src.qty, 1);
    return {
      item_name: String(src.item_name || '').trim(),
      location: String(src.location || '').trim(),
      qty: qty > 0 ? qty : 1,
      unit_price: toNumber(src.unit_price, 0),
    };
  }

  function defaultState() {
    return {
      categories: [normalizeCategory({ category: '', description: '', amount: 0 })],
      items: [normalizeItem({ item_name: '', location: '', qty: 1, unit_price: 0 })],
    };
  }

  function compute(state) {
    var totalA = state.categories.reduce(function (sum, row) {
      return sum + toNumber(row.amount, 0);
    }, 0);
    var totalB = state.items.reduce(function (sum, row) {
      return sum + toNumber(row.qty, 0) * toNumber(row.unit_price, 0);
    }, 0);
    return { totalA: totalA, totalB: totalB, total: totalA + totalB };
  }

  function cloneState(state) {
    var totals = compute(state);
    return {
      categories: state.categories.map(function (row) {
        return { category: row.category, description: row.description, amount: toNumber(row.amount, 0) };
      }),
      items: state.items.map(function (row) {
        return {
          item_name: row.item_name,
          location: row.location,
          qty: toNumber(row.qty, 1),
          unit_price: toNumber(row.unit_price, 0),
        };
      }),
      totalA: totals.totalA,
      totalB: totals.totalB,
      total: totals.total,
    };
  }

  function buildOptionsHtml(options, currentValue) {
    var out = ['<option value=""></option>'];
    for (var i = 0; i < options.length; i += 1) {
      var opt = options[i];
      var selected = String(opt) === String(currentValue || '') ? ' selected' : '';
      out.push('<option value="' + esc(opt) + '"' + selected + '>' + esc(opt) + '</option>');
    }
    return out.join('');
  }

  function mount(container, options) {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('IH35TwoSectionCost.mount requires a valid HTMLElement container');
    }
    ensureStyles();
    var opts = options && typeof options === 'object' ? options : {};
    var state = defaultState();

    if (Array.isArray(opts.initialCategories) && opts.initialCategories.length) {
      state.categories = opts.initialCategories.map(normalizeCategory);
    }
    if (Array.isArray(opts.initialItems) && opts.initialItems.length) {
      state.items = opts.initialItems.map(normalizeItem);
    }

    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    var root = document.createElement('div');
    root.className = 'ih-two-section-cost';
    container.innerHTML = '';
    container.appendChild(root);

    function emitChange() {
      if (onChange) onChange(cloneState(state));
    }

    function updateComputedUi() {
      var totals = compute(state);
      var subtotalAEl = root.querySelector('[data-role="subtotal-a"]');
      var subtotalBEl = root.querySelector('[data-role="subtotal-b"]');
      var totalEl = root.querySelector('[data-role="total"]');
      if (subtotalAEl) subtotalAEl.textContent = money(totals.totalA);
      if (subtotalBEl) subtotalBEl.textContent = money(totals.totalB);
      if (totalEl) totalEl.textContent = money(totals.total);
      for (var i = 0; i < state.items.length; i += 1) {
        var lineCell = root.querySelector('[data-role="item-line-total"][data-index="' + i + '"]');
        if (lineCell) lineCell.textContent = money(toNumber(state.items[i].qty, 0) * toNumber(state.items[i].unit_price, 0));
      }
    }

    function render() {
      var catRows = state.categories
        .map(function (row, idx) {
          return (
            '<tr>' +
            '<td style="width:32%"><select class="ih-two-section-cost__select" data-section="categories" data-index="' + idx + '" data-field="category">' +
            buildOptionsHtml(CATEGORY_OPTIONS, row.category) +
            '</select></td>' +
            '<td><input class="ih-two-section-cost__input" type="text" value="' + esc(row.description) + '" data-section="categories" data-index="' + idx + '" data-field="description"/></td>' +
            '<td class="num" style="width:90px"><input class="ih-two-section-cost__input" type="number" step="0.01" value="' + esc(row.amount) + '" data-section="categories" data-index="' + idx + '" data-field="amount"/></td>' +
            '<td style="width:24px"><button type="button" class="ih-two-section-cost__row-del" data-action="remove-cat" data-index="' + idx + '">×</button></td>' +
            '</tr>'
          );
        })
        .join('');

      var itemRows = state.items
        .map(function (row, idx) {
          var lineTotal = toNumber(row.qty, 0) * toNumber(row.unit_price, 0);
          return (
            '<tr>' +
            '<td style="width:26%"><select class="ih-two-section-cost__select" data-section="items" data-index="' + idx + '" data-field="item_name">' +
            buildOptionsHtml(ITEM_OPTIONS, row.item_name) +
            '</select></td>' +
            '<td style="width:22%"><input class="ih-two-section-cost__input" type="text" value="' + esc(row.location) + '" data-section="items" data-index="' + idx + '" data-field="location"/></td>' +
            '<td style="width:50px"><input class="ih-two-section-cost__input" type="number" step="1" value="' + esc(row.qty) + '" data-section="items" data-index="' + idx + '" data-field="qty"/></td>' +
            '<td style="width:80px"><input class="ih-two-section-cost__input" type="number" step="0.01" value="' + esc(row.unit_price) + '" data-section="items" data-index="' + idx + '" data-field="unit_price"/></td>' +
            '<td class="num" style="width:80px"><span class="ih-two-section-cost__line-total" data-role="item-line-total" data-index="' + idx + '">' + money(lineTotal) + '</span></td>' +
            '<td style="width:24px"><button type="button" class="ih-two-section-cost__row-del" data-action="remove-item" data-index="' + idx + '">×</button></td>' +
            '</tr>'
          );
        })
        .join('');

      root.innerHTML =
        '<section>' +
        '<div class="ih-two-section-cost__head ih-two-section-cost__head--a">' +
        '<div class="ih-two-section-cost__title">Section A · Categories</div>' +
        '<button type="button" class="ih-two-section-cost__add" data-action="add-cat">+ Add category line</button>' +
        '</div>' +
        '<table class="ih-two-section-cost__table">' +
        '<thead><tr><th style="width:32%">Category</th><th>Description</th><th class="num" style="width:90px">Amount</th><th style="width:24px"></th></tr></thead>' +
        '<tbody>' + catRows + '</tbody>' +
        '<tfoot><tr class="ih-two-section-cost__subtotal-row"><td colspan="2" class="ih-two-section-cost__subtotal-label">Section A subtotal</td><td class="num" data-role="subtotal-a">' + money(0) + '</td><td></td></tr></tfoot>' +
        '</table>' +
        '</section>' +
        '<section>' +
        '<div class="ih-two-section-cost__head ih-two-section-cost__head--b">' +
        '<div class="ih-two-section-cost__title">Section B · Items (parts &amp; service)</div>' +
        '<button type="button" class="ih-two-section-cost__add" data-action="add-item">+ Add item line</button>' +
        '</div>' +
        '<table class="ih-two-section-cost__table">' +
        '<thead><tr><th style="width:26%">Item</th><th style="width:22%">Location</th><th style="width:50px">Qty</th><th style="width:80px">Unit $</th><th class="num" style="width:80px">Line $</th><th style="width:24px"></th></tr></thead>' +
        '<tbody>' + itemRows + '</tbody>' +
        '<tfoot><tr class="ih-two-section-cost__subtotal-row"><td colspan="4" class="ih-two-section-cost__subtotal-label">Section B subtotal</td><td class="num" data-role="subtotal-b">' + money(0) + '</td><td></td></tr></tfoot>' +
        '</table>' +
        '</section>' +
        '<div class="ih-two-section-cost__total"><span class="ih-two-section-cost__total-label">Total · A + B</span><span class="ih-two-section-cost__total-value" data-role="total">' + money(0) + '</span></div>';

      updateComputedUi();
    }

    function removeByIndex(section, index) {
      if (section === 'categories') {
        state.categories.splice(index, 1);
      } else if (section === 'items') {
        state.items.splice(index, 1);
      }
      render();
      emitChange();
    }

    function updateField(target) {
      var section = target.getAttribute('data-section');
      var idx = Number(target.getAttribute('data-index'));
      var field = target.getAttribute('data-field');
      if (!Number.isFinite(idx) || idx < 0 || !field) return;
      var row = section === 'categories' ? state.categories[idx] : state.items[idx];
      if (!row) return;
      if (field === 'amount' || field === 'qty' || field === 'unit_price') {
        row[field] = toNumber(target.value, 0);
        if (field === 'qty' && row[field] <= 0) row[field] = 0;
      } else {
        row[field] = String(target.value || '').trim();
      }
      updateComputedUi();
      emitChange();
    }

    function onClick(event) {
      var button = event.target.closest('button');
      if (!button) return;
      var action = button.getAttribute('data-action');
      if (!action) return;
      if (action === 'add-cat') {
        state.categories.push(normalizeCategory({ category: '', description: '', amount: 0 }));
        render();
        emitChange();
        return;
      }
      if (action === 'add-item') {
        state.items.push(normalizeItem({ item_name: '', location: '', qty: 1, unit_price: 0 }));
        render();
        emitChange();
        return;
      }
      if (action === 'remove-cat') {
        removeByIndex('categories', Number(button.getAttribute('data-index')));
        return;
      }
      if (action === 'remove-item') {
        removeByIndex('items', Number(button.getAttribute('data-index')));
      }
    }

    function onInput(event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      if (!target.getAttribute('data-section')) return;
      updateField(target);
    }

    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);

    render();
    emitChange();

    return {
      getState: function getState() {
        return cloneState(state);
      },
      setState: function setState(newState) {
        var next = newState && typeof newState === 'object' ? newState : {};
        state.categories = Array.isArray(next.categories) && next.categories.length
          ? next.categories.map(normalizeCategory)
          : defaultState().categories;
        state.items = Array.isArray(next.items) && next.items.length
          ? next.items.map(normalizeItem)
          : defaultState().items;
        render();
        emitChange();
      },
      reset: function reset() {
        state = defaultState();
        render();
        emitChange();
      },
      destroy: function destroy() {
        root.removeEventListener('click', onClick);
        root.removeEventListener('input', onInput);
        root.removeEventListener('change', onInput);
        if (container.contains(root)) container.removeChild(root);
      },
    };
  }

  global.IH35TwoSectionCost = { mount: mount };
})(window);
