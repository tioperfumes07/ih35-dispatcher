(function initIH35TwoSectionCost(global) {
  'use strict';

  var CATEGORY_LIST_ID = 'ih35_categories';
  var ITEM_LIST_ID = 'ih35_items';
  var FUEL_ITEMS = ['truck diesel', 'reefer diesel', 'def'];

  var CATEGORY_OPTIONS = [
    'Fuel',
    'Repair / Maintenance',
    'Tire / Road service',
    'Toll',
    'Lumper',
    'Detention',
    'Office / Admin',
    'Other'
  ];

  var ITEM_OPTIONS = [
    'Truck Diesel',
    'Reefer Diesel',
    'DEF',
    'SVC-OIL01 — Oil & filter change',
    'SVC-BRK01 — Brake job front',
    'SVC-DOT01 — DOT inspection',
    'TX TollTag transaction',
    'Walmart DC lumper',
    'Shipper detention 3.5h',
    'Office supplies'
  ];

  var DEFAULT_CATEGORY = { category: '', description: '', qty: 1, amount: 0 };
  var DEFAULT_ITEM = { item: '', qty: 1, amount: 0, odo_fill_at: null };

  var fmt = function (n) {
    return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };

  function toNum(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isFuelItem(itemValue) {
    var t = String(itemValue || '').trim().toLowerCase();
    return FUEL_ITEMS.indexOf(t) !== -1;
  }

  function normalizeCategoryLine(line) {
    var src = line && typeof line === 'object' ? line : {};
    var qty = toNum(src.qty, 1);
    var amount = toNum(src.amount, 0);
    if (qty < 0) qty = 0;
    return {
      category: String(src.category || '').trim(),
      description: String(src.description || '').trim(),
      qty: qty,
      amount: amount,
      total: qty * amount
    };
  }

  function normalizeItemLine(line) {
    var src = line && typeof line === 'object' ? line : {};
    var item = String(src.item || '').trim();
    var qty = toNum(src.qty, 1);
    var amount = toNum(src.amount, 0);
    if (qty < 0) qty = 0;
    var fuel = isFuelItem(item);
    var odo = fuel ? (src.odo_fill_at == null || src.odo_fill_at === '' ? null : toNum(src.odo_fill_at, null)) : null;
    return {
      item: item,
      qty: qty,
      amount: amount,
      total: qty * amount,
      odo_fill_at: odo
    };
  }

  function makeDefaultState() {
    return {
      categories: [normalizeCategoryLine(DEFAULT_CATEGORY)],
      items: [normalizeItemLine(DEFAULT_ITEM)],
      subtotalA: 0,
      subtotalB: 0,
      total: 0
    };
  }

  function recalc(state) {
    var subtotalA = 0;
    var subtotalB = 0;
    var i;
    for (i = 0; i < state.categories.length; i += 1) {
      state.categories[i].total = toNum(state.categories[i].qty, 0) * toNum(state.categories[i].amount, 0);
      subtotalA += state.categories[i].total;
    }
    for (i = 0; i < state.items.length; i += 1) {
      var fuel = isFuelItem(state.items[i].item);
      state.items[i].total = toNum(state.items[i].qty, 0) * toNum(state.items[i].amount, 0);
      if (!fuel) state.items[i].odo_fill_at = null;
      subtotalB += state.items[i].total;
    }
    state.subtotalA = subtotalA;
    state.subtotalB = subtotalB;
    state.total = subtotalA + subtotalB;
    return state;
  }

  function cloneState(state) {
    return {
      categories: state.categories.map(function (row) {
        return {
          category: row.category,
          description: row.description,
          qty: toNum(row.qty, 0),
          amount: toNum(row.amount, 0),
          total: toNum(row.total, 0)
        };
      }),
      items: state.items.map(function (row) {
        return {
          item: row.item,
          qty: toNum(row.qty, 0),
          amount: toNum(row.amount, 0),
          total: toNum(row.total, 0),
          odo_fill_at: row.odo_fill_at == null ? null : toNum(row.odo_fill_at, null)
        };
      }),
      subtotalA: toNum(state.subtotalA, 0),
      subtotalB: toNum(state.subtotalB, 0),
      total: toNum(state.total, 0)
    };
  }

  function ensureCatalogDatalists() {
    var head = document.head || document.documentElement;
    if (!document.getElementById(CATEGORY_LIST_ID)) {
      var catList = document.createElement('datalist');
      catList.id = CATEGORY_LIST_ID;
      for (var i = 0; i < CATEGORY_OPTIONS.length; i += 1) {
        var catOpt = document.createElement('option');
        catOpt.value = CATEGORY_OPTIONS[i];
        catList.appendChild(catOpt);
      }
      head.appendChild(catList);
    }
    if (!document.getElementById(ITEM_LIST_ID)) {
      var itemList = document.createElement('datalist');
      itemList.id = ITEM_LIST_ID;
      for (var j = 0; j < ITEM_OPTIONS.length; j += 1) {
        var itemOpt = document.createElement('option');
        itemOpt.value = ITEM_OPTIONS[j];
        itemList.appendChild(itemOpt);
      }
      head.appendChild(itemList);
    }
  }

  function mount(container, options) {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('IH35TwoSectionCost.mount requires an HTMLElement container');
    }

    ensureCatalogDatalists();
    var opts = options && typeof options === 'object' ? options : {};
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    var state = makeDefaultState();

    if (Array.isArray(opts.initialCategoryLines) && opts.initialCategoryLines.length) {
      state.categories = opts.initialCategoryLines.map(normalizeCategoryLine);
    }
    if (Array.isArray(opts.initialItemLines) && opts.initialItemLines.length) {
      state.items = opts.initialItemLines.map(normalizeItemLine);
    }
    recalc(state);

    var root = document.createElement('div');
    root.style.display = 'grid';
    root.style.gap = '8px';
    root.style.fontFamily = 'Arial,sans-serif';
    root.style.color = '#1a1f36';
    container.innerHTML = '';
    container.appendChild(root);

    function emit() {
      if (onChange) onChange(cloneState(state));
    }

    function categoryRowHtml(row, idx) {
      return '' +
        '<tr>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:22%;">' +
            '<input list="' + CATEGORY_LIST_ID + '" data-kind="category" data-index="' + idx + '" data-field="category" value="' + esc(row.category) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;border:0.5px solid #d4c89a;border-radius:2px;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;">' +
            '<input data-kind="category" data-index="' + idx + '" data-field="description" value="' + esc(row.description) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;border:0.5px solid #d4c89a;border-radius:2px;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:50px;">' +
            '<input type="number" step="1" data-kind="category" data-index="' + idx + '" data-field="qty" value="' + esc(row.qty) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;text-align:right;border:0.5px solid #d4c89a;border-radius:2px;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:70px;">' +
            '<input type="number" step="0.01" data-kind="category" data-index="' + idx + '" data-field="amount" value="' + esc(row.amount) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;text-align:right;border:0.5px solid #d4c89a;border-radius:2px;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:70px;">' +
            '<input readonly value="' + esc(fmt(row.total)) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;text-align:right;border:0.5px solid #97c459;border-radius:2px;background:#eaf3de;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 2px;height:17px;font-size:9px;width:16px;text-align:center;">' +
            '<button type="button" data-action="remove-category" data-index="' + idx + '" style="height:16px;width:16px;padding:0;border:0.5px solid transparent;border-radius:2px;background:transparent;color:#999;cursor:pointer;font-size:10px;line-height:1;">×</button>' +
          '</td>' +
        '</tr>';
    }

    function itemRowHtml(row, idx) {
      var fuel = isFuelItem(row.item);
      var odoValue = row.odo_fill_at == null ? '' : String(row.odo_fill_at);
      return '' +
        '<tr>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:32%;">' +
            '<input list="' + ITEM_LIST_ID + '" data-kind="item" data-index="' + idx + '" data-field="item" value="' + esc(row.item) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;border:0.5px solid #97c459;border-radius:2px;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:50px;">' +
            '<input type="number" step="1" data-kind="item" data-index="' + idx + '" data-field="qty" value="' + esc(row.qty) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;text-align:right;border:0.5px solid #97c459;border-radius:2px;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:70px;">' +
            '<input type="number" step="0.01" data-kind="item" data-index="' + idx + '" data-field="amount" value="' + esc(row.amount) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;text-align:right;border:0.5px solid #97c459;border-radius:2px;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:70px;">' +
            '<input readonly value="' + esc(fmt(row.total)) + '" style="height:17px;width:100%;padding:0 4px;font-size:9px;text-align:right;border:0.5px solid #97c459;border-radius:2px;background:#eaf3de;box-sizing:border-box;" />' +
          '</td>' +
          '<td style="padding:1px 4px;height:17px;font-size:9px;width:80px;">' +
            '<input type="number" step="1" data-kind="item" data-index="' + idx + '" data-field="odo_fill_at" value="' + esc(odoValue) + '" placeholder="' + (fuel ? '' : 'n/a') + '" ' + (fuel ? '' : 'disabled') + ' style="height:17px;width:100%;padding:0 4px;font-size:9px;text-align:right;border:0.5px solid #97c459;border-radius:2px;box-sizing:border-box;background:' + (fuel ? '#fff' : '#f4f4f0') + ';" />' +
          '</td>' +
          '<td style="padding:1px 2px;height:17px;font-size:9px;width:16px;text-align:center;">' +
            '<button type="button" data-action="remove-item" data-index="' + idx + '" style="height:16px;width:16px;padding:0;border:0.5px solid transparent;border-radius:2px;background:transparent;color:#999;cursor:pointer;font-size:10px;line-height:1;">×</button>' +
          '</td>' +
        '</tr>';
    }

    function render() {
      var catRows = state.categories.map(categoryRowHtml).join('');
      var itemRows = state.items.map(itemRowHtml).join('');
      root.innerHTML =
        '<div style="display:grid;gap:6px;">' +
          '<div style="height:22px;padding:4px 8px;background:#f5e8c8;color:#6b4f00;border:0.5px solid #d4c89a;border-left:3px solid #b07d00;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;font-size:8px;text-transform:uppercase;letter-spacing:0.4px;font-weight:500;">' +
            '<span>SECTION A · CATEGORIES</span>' +
            '<button type="button" data-action="add-category" style="height:14px;font-size:8px;padding:0 6px;background:#fff;border:0.5px solid #b07d00;color:#6b4f00;border-radius:2px;cursor:pointer;">+ Add category line</button>' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;border:0.5px solid #d4c89a;table-layout:fixed;">' +
            '<thead style="background:#faf3e0;">' +
              '<tr>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#6b4f00;width:22%;">Category</th>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#6b4f00;">Description</th>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#6b4f00;width:50px;">Qty</th>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#6b4f00;width:70px;">Amount</th>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#6b4f00;width:70px;">Total</th>' +
                '<th style="text-align:left;padding:2px 2px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#6b4f00;width:16px;"></th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + catRows + '</tbody>' +
            '<tfoot>' +
              '<tr style="background:#f5e8c8;">' +
                '<td colspan="4" style="padding:2px 6px;text-align:right;font-size:8px;letter-spacing:0.3px;text-transform:uppercase;color:#6b4f00;">Subtotal A</td>' +
                '<td style="padding:2px 6px;text-align:right;font-size:9px;color:#6b4f00;" data-role="subtotal-a">' + fmt(state.subtotalA) + '</td>' +
                '<td></td>' +
              '</tr>' +
            '</tfoot>' +
          '</table>' +
        '</div>' +
        '<div style="display:grid;gap:6px;">' +
          '<div style="height:22px;padding:4px 8px;background:#d8e8d8;color:#173404;border:0.5px solid #97c459;border-left:3px solid #1a7a3c;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;font-size:8px;text-transform:uppercase;letter-spacing:0.4px;font-weight:500;">' +
            '<span>SECTION B · ITEMS</span>' +
            '<button type="button" data-action="add-item" style="height:14px;font-size:8px;padding:0 6px;background:#fff;border:0.5px solid #1a7a3c;color:#173404;border-radius:2px;cursor:pointer;">+ Add item line</button>' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;border:0.5px solid #97c459;table-layout:fixed;">' +
            '<thead style="background:#ecf3ec;">' +
              '<tr>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#173404;width:32%;">Item</th>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#173404;width:50px;">Qty</th>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#173404;width:70px;">Amount</th>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#173404;width:70px;">Total</th>' +
                '<th style="text-align:left;padding:2px 6px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#173404;width:80px;">ODO fill at</th>' +
                '<th style="text-align:left;padding:2px 2px;font-size:8px;text-transform:uppercase;letter-spacing:0.3px;color:#173404;width:16px;"></th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + itemRows + '</tbody>' +
            '<tfoot>' +
              '<tr style="background:#d8e8d8;">' +
                '<td colspan="3" style="padding:2px 6px;text-align:right;font-size:8px;letter-spacing:0.3px;text-transform:uppercase;color:#173404;">Subtotal B</td>' +
                '<td style="padding:2px 6px;text-align:right;font-size:9px;color:#173404;" data-role="subtotal-b">' + fmt(state.subtotalB) + '</td>' +
                '<td></td>' +
                '<td></td>' +
              '</tr>' +
            '</tfoot>' +
          '</table>' +
        '</div>' +
        '<div style="height:22px;padding:4px 8px;background:#1a1f36;color:#fff;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;font-size:9px;text-transform:uppercase;letter-spacing:0.4px;">' +
          '<span>TOTAL · A + B</span>' +
          '<span data-role="grand-total" style="font-size:11px;font-weight:500;">' + fmt(state.total) + '</span>' +
        '</div>';

      // Pattern C (parts panel) deferred to future prompt.
    }

    function applyFieldChange(target) {
      var kind = target.getAttribute('data-kind');
      var idx = toNum(target.getAttribute('data-index'), -1);
      var field = target.getAttribute('data-field');
      if (idx < 0 || !field) return;

      if (kind === 'category') {
        var cat = state.categories[idx];
        if (!cat) return;
        if (field === 'qty') cat.qty = toNum(target.value, 0);
        else if (field === 'amount') cat.amount = toNum(target.value, 0);
        else cat[field] = String(target.value || '').trim();
      } else if (kind === 'item') {
        var itm = state.items[idx];
        if (!itm) return;
        if (field === 'qty') itm.qty = toNum(target.value, 0);
        else if (field === 'amount') itm.amount = toNum(target.value, 0);
        else if (field === 'odo_fill_at') itm.odo_fill_at = target.value === '' ? null : toNum(target.value, null);
        else if (field === 'item') itm.item = String(target.value || '').trim();
      }

      recalc(state);
      render();
      emit();
    }

    function onRootClick(event) {
      var btn = event.target && event.target.closest ? event.target.closest('button[data-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-action');
      var idx = toNum(btn.getAttribute('data-index'), -1);
      if (action === 'add-category') {
        state.categories.push(normalizeCategoryLine(DEFAULT_CATEGORY));
      } else if (action === 'add-item') {
        state.items.push(normalizeItemLine(DEFAULT_ITEM));
      } else if (action === 'remove-category' && idx >= 0) {
        state.categories.splice(idx, 1);
        if (!state.categories.length) state.categories = [normalizeCategoryLine(DEFAULT_CATEGORY)];
      } else if (action === 'remove-item' && idx >= 0) {
        state.items.splice(idx, 1);
        if (!state.items.length) state.items = [normalizeItemLine(DEFAULT_ITEM)];
      } else {
        return;
      }
      recalc(state);
      render();
      emit();
    }

    function onRootInput(event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      if (!target.getAttribute('data-kind')) return;
      applyFieldChange(target);
    }

    root.addEventListener('click', onRootClick);
    root.addEventListener('input', onRootInput);
    root.addEventListener('change', onRootInput);

    render();
    emit();

    return {
      getState: function getState() {
        recalc(state);
        return cloneState(state);
      },
      setState: function setState(newState) {
        var next = newState && typeof newState === 'object' ? newState : {};
        var cat = Array.isArray(next.categories) && next.categories.length
          ? next.categories.map(normalizeCategoryLine)
          : [normalizeCategoryLine(DEFAULT_CATEGORY)];
        var itm = Array.isArray(next.items) && next.items.length
          ? next.items.map(normalizeItemLine)
          : [normalizeItemLine(DEFAULT_ITEM)];
        state = { categories: cat, items: itm, subtotalA: 0, subtotalB: 0, total: 0 };
        recalc(state);
        render();
        emit();
      },
      reset: function reset() {
        state = makeDefaultState();
        recalc(state);
        render();
        emit();
      },
      destroy: function destroy() {
        root.removeEventListener('click', onRootClick);
        root.removeEventListener('input', onRootInput);
        root.removeEventListener('change', onRootInput);
        container.innerHTML = '';
      }
    };
  }

  global.IH35TwoSectionCost = {
    mount: mount
  };
})(window);
