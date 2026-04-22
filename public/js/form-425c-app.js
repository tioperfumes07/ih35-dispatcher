/**
 * Form 425C — React (UMD) via React.createElement only. No build step.
 */
(function () {
  'use strict';
  var Q_LINES = [
    [1, 'Did the business operate during the entire reporting period?'],
    [2, 'Do you plan to continue to operate the business next month?'],
    [3, 'Have you paid all of your bills on time?'],
    [4, 'Did you pay your employees on time?'],
    [5, 'Have you deposited all receipts into DIP accounts?'],
    [6, 'Have you timely filed tax returns and paid taxes?'],
    [7, 'Have you timely filed all other required government filings?'],
    [8, 'Current on quarterly U.S. Trustee / Bankruptcy Administrator fees?'],
    [9, 'Timely paid all insurance premiums?'],
    [10, 'Any bank accounts open other than DIP accounts?'],
    [11, 'Sold any assets other than inventory?'],
    [12, 'Sold/transferred assets or services to anyone related to the DIP?'],
    [13, 'Any insurance company cancel your policy?'],
    [14, 'Unusual or significant unanticipated expenses?'],
    [15, 'Borrowed money or payments made on your behalf?'],
    [16, 'Anyone made an investment in your business?'],
    [17, 'Paid pre-petition bills?'],
    [18, 'Allowed pre-petition checks to clear?']
  ];
  var PROJ_ROWS = [
    ['32', 'Projected gross receipts / cash inflows'],
    ['33', 'Projected total cash disbursements'],
    ['34', 'Projected payroll & benefits'],
    ['35', 'Projected fleet / fuel / maintenance'],
    ['36', 'Projected insurance & professional fees'],
    ['37', 'Other material items (describe in notes)']
  ];
  var ATTACH_KEYS = [
    ['pl', 'Profit & loss (month)'],
    ['bs', 'Balance sheet'],
    ['bankStmt', 'Bank statements (all DIP accounts)'],
    ['bankRec', 'Bank reconciliation worksheets'],
    ['ar', 'Accounts receivable aging'],
    ['ap', 'Accounts payable / unpaid bills detail'],
    ['exC', 'Exhibit C — cash receipts'],
    ['exD', 'Exhibit D — disbursements'],
    ['other', 'Other exhibits (attach description in notes)']
  ];

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function defaultProjections() {
    var o = {};
    for (var i = 0; i < PROJ_ROWS.length; i++) {
      var c = PROJ_ROWS[i][0];
      o[c] = { prior: '', current: '', next: '' };
    }
    return o;
  }

  function defaultAttachments() {
    var o = {};
    for (var i = 0; i < ATTACH_KEYS.length; i++) {
      o[ATTACH_KEYS[i][0]] = false;
    }
    return o;
  }

  function defaultReportState() {
    return {
      paperMonth: '',
      paperFiled: '',
      paperLob: '',
      paperNaics: '',
      paperRp: '',
      paperDebtor: '',
      paperCase: '',
      paperCourt: '',
      line19: '',
      line20: '',
      line21: '',
      line22: '',
      line23: '',
      line24: '',
      line25: '',
      line26: '',
      line27: '',
      line28: '',
      line29: '',
      line30: '',
      line31: '',
      paperNotes: '',
      questionnaire: {},
      projections: defaultProjections(),
      attachments: defaultAttachments()
    };
  }

  function projectionsFromSaved(rows) {
    var by = {};
    (rows || []).forEach(function (r) {
      if (r && r.line) by[r.line] = { prior: r.prior || '', current: r.current || '', next: r.next || '' };
    });
    var o = defaultProjections();
    Object.keys(o).forEach(function (k) {
      if (by[k]) o[k] = by[k];
    });
    return o;
  }

  function Form425CApp() {
    var h = React.createElement;

    var tabState = React.useState('profile');
    var tab = tabState[0];
    var setTab = tabState[1];

    var profilesState = React.useState({ version: 1, companies: [] });
    var profiles = profilesState[0];
    var setProfiles = profilesState[1];

    var banksState = React.useState([]);
    var banks = banksState[0];
    var setBanks = banksState[1];

    var repCoState = React.useState('');
    var repCompany = repCoState[0];
    var setRepCompany = repCoState[1];

    var repMoState = React.useState('');
    var repMonth = repMoState[0];
    var setRepMonth = repMoState[1];

    var qbCoState = React.useState('');
    var qbCompany = qbCoState[0];
    var setQbCompany = qbCoState[1];

    var pasteState = React.useState('');
    var pasteText = pasteState[0];
    var setPasteText = pasteState[1];

    var lastPasteState = React.useState(null);
    var lastPaste = lastPasteState[0];
    var setLastPaste = lastPasteState[1];

    var lastQboState = React.useState(null);
    var lastQbo = lastQboState[0];
    var setLastQbo = lastQboState[1];

    var reportState = React.useState(defaultReportState);
    var report = reportState[0];
    var setReport = reportState[1];

    var exDState = React.useState([{ date: '', payee: '', amount: '', memo: '' }]);
    var exhibitD = exDState[0];
    var setExhibitD = exDState[1];

    var histState = React.useState([]);
    var historyList = histState[0];
    var setHistoryList = histState[1];

    var bankMsgState = React.useState('');
    var bankLoadMsg = bankMsgState[0];
    var setBankLoadMsg = bankMsgState[1];

    var recMsgState = React.useState('');
    var receiptMsg = recMsgState[0];
    var setReceiptMsg = recMsgState[1];

    var qbMsgState = React.useState('');
    var qbPasteMsg = qbMsgState[0];
    var setQbPasteMsg = qbMsgState[1];

    var mergeMsgState = React.useState('');
    var mergeMsg = mergeMsgState[0];
    var setMergeMsg = mergeMsgState[1];

    var monthPhState = React.useState('');
    var monthPlaceholder = monthPhState[0];
    var setMonthPlaceholder = monthPhState[1];

    var mergeRef = React.useRef(null);

    React.useEffect(function () {
      var d = new Date();
      d.setMonth(d.getMonth() - 1);
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      setRepMonth(y + '-' + m);
      setMonthPlaceholder(d.toLocaleString(undefined, { month: 'long', year: 'numeric' }));
    }, []);

    React.useEffect(function () {
      var cancelled = false;
      (async function () {
        try {
          var r = await fetch('/api/form-425c/profiles');
          var data = await r.json();
          if (cancelled) return;
          setProfiles(data);
          var first = (data.companies || [])[0];
          if (first) {
            setRepCompany(function (c) {
              return c || first.id;
            });
            setQbCompany(function (c) {
              return c || first.id;
            });
            applyProfileFromCompany(first);
          }
        } catch (e) {
          console.error(e);
        }
      })();
      return function () {
        cancelled = true;
      };
    }, []);

    React.useEffect(function () {
      refreshHistory();
    }, []);

    function applyProfileFromCompany(c) {
      if (!c) return;
      setReport(function (r) {
        return {
          ...r,
          paperDebtor: c.debtorName || '',
          paperCase: c.caseNumber || '',
          paperCourt: [c.courtDistrict, c.courtDivision].filter(Boolean).join(' \u00b7 '),
          paperNaics: c.naicsCode || '',
          paperLob: c.lineOfBusiness || '',
          paperRp: c.responsiblePartyName || ''
        };
      });
    }

    function applySelectedProfileToPaper(companyId) {
      var c = (profiles.companies || []).find(function (x) {
        return x.id === companyId;
      });
      applyProfileFromCompany(c);
    }

    React.useEffect(function () {
      var n = function (v) {
        return parseFloat(String(v == null ? '' : v).replace(/,/g, '')) || 0;
      };
      var o19 = n(report.line19);
      var o20 = n(report.line20);
      var o21 = n(report.line21);
      var flow = Math.round((o20 - o21) * 100) / 100;
      var end = Math.round((o19 + flow) * 100) / 100;
      var l22 = flow ? String(flow) : '';
      var l23 = end ? String(end) : '';
      setReport(function (r) {
        if (r.line22 === l22 && r.line23 === l23) return r;
        return { ...r, line22: l22, line23: l23 };
      });
    }, [report.line19, report.line20, report.line21]);

    async function refreshHistory() {
      try {
        var r = await fetch('/api/form-425c/saved-reports');
        var d = await r.json();
        setHistoryList(d.reports || []);
      } catch (e) {
        console.error(e);
      }
    }

    function patchCompany(cid, patch) {
      setProfiles(function (p) {
        return {
          ...p,
          companies: p.companies.map(function (c) {
            return c.id === cid ? { ...c, ...patch } : c;
          })
        };
      });
    }

    function patchCompanyDefQ(cid, n, val) {
      setProfiles(function (p) {
        return {
          ...p,
          companies: p.companies.map(function (c) {
            if (c.id !== cid) return c;
            var dq = { ...(c.defaultQuestionnaire || {}) };
            dq[String(n)] = val;
            return { ...c, defaultQuestionnaire: dq };
          })
        };
      });
    }

    function toggleBank(cid, qboId, on) {
      setProfiles(function (p) {
        return {
          ...p,
          companies: p.companies.map(function (c) {
            if (c.id !== cid) return c;
            var ids = new Set((c.bankAccountQboIds || []).map(String));
            if (on) ids.add(String(qboId));
            else ids.delete(String(qboId));
            var idArr = [...ids];
            var labels = banks
              .filter(function (a) {
                return ids.has(String(a.id));
              })
              .map(function (a) {
                return a.name;
              });
            return { ...c, bankAccountQboIds: idArr, bankAccountLabels: labels };
          })
        };
      });
    }

    async function loadBanks() {
      setBankLoadMsg('Loading\u2026');
      try {
        var r = await fetch('/api/form-425c/qbo-bank-accounts');
        var d = await r.json();
        if (!d.ok) throw new Error(d.error || 'QBO error');
        setBanks(d.accounts || []);
        setBankLoadMsg('Loaded ' + (d.accounts || []).length + ' bank account(s).');
      } catch (e) {
        setBankLoadMsg(String(e.message || e));
      }
    }

    async function saveProfiles() {
      var r = await fetch('/api/form-425c/profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profiles)
      });
      if (!r.ok) {
        alert(await r.text());
        return;
      }
      setProfiles(await r.json());
      alert('Profiles saved.');
    }

    function applyQDefaults() {
      var c = (profiles.companies || []).find(function (x) {
        return x.id === repCompany;
      });
      if (!c || !c.defaultQuestionnaire) return;
      setReport(function (r) {
        return { ...r, questionnaire: { ...c.defaultQuestionnaire } };
      });
      setReceiptMsg('Questionnaire set from profile defaults.');
    }

    function setQ(n, val) {
      setReport(function (r) {
        var q = { ...r.questionnaire };
        q[String(n)] = val;
        return { ...r, questionnaire: q };
      });
    }

    function gatherReportPayload() {
      var displayLines = lastQbo
        ? lastQbo.exhibitCLines || []
        : lastPaste
          ? lastPaste.rows || []
          : [];
      return {
        questionnaire: report.questionnaire,
        paper: {
          monthLabel: report.paperMonth,
          filedDate: report.paperFiled,
          lineOfBusiness: report.paperLob,
          naicsCode: report.paperNaics,
          responsibleParty: report.paperRp,
          debtorName: report.paperDebtor,
          caseNumber: report.paperCase,
          court: report.paperCourt
        },
        cash: {
          line19: report.line19,
          line20: report.line20,
          line21: report.line21,
          line22: report.line22,
          line23: report.line23
        },
        parts34: {
          line24: report.line24,
          line25: report.line25,
          line26: report.line26,
          line27: report.line27,
          line28: report.line28,
          line29: report.line29,
          line30: report.line30,
          line31: report.line31
        },
        projections: PROJ_ROWS.map(function (row) {
          var code = row[0];
          var pr = report.projections[code] || { prior: '', current: '', next: '' };
          return { line: code, prior: pr.prior, current: pr.current, next: pr.next };
        }),
        attachments: report.attachments,
        exhibitC: {
          source: lastQbo ? 'qbo' : lastPaste ? 'paste' : null,
          qbo: lastQbo,
          paste: lastPaste,
          displayLines: displayLines
        },
        exhibitD: exhibitD,
        notes: report.paperNotes
      };
    }

    function applyReportPayload(data) {
      if (!data) return;
      var p = data.paper || {};
      var cash = data.cash || {};
      var parts = data.parts34 || {};
      setReport(function (r) {
        return {
          ...r,
          paperMonth: p.monthLabel != null ? String(p.monthLabel) : r.paperMonth,
          paperFiled: p.filedDate != null ? String(p.filedDate) : r.paperFiled,
          paperLob: p.lineOfBusiness != null ? String(p.lineOfBusiness) : r.paperLob,
          paperNaics: p.naicsCode != null ? String(p.naicsCode) : r.paperNaics,
          paperRp: p.responsibleParty != null ? String(p.responsibleParty) : r.paperRp,
          paperDebtor: p.debtorName != null ? String(p.debtorName) : r.paperDebtor,
          paperCase: p.caseNumber != null ? String(p.caseNumber) : r.paperCase,
          paperCourt: p.court != null ? String(p.court) : r.paperCourt,
          line19: cash.line19 != null ? String(cash.line19) : r.line19,
          line20: cash.line20 != null ? String(cash.line20) : r.line20,
          line21: cash.line21 != null ? String(cash.line21) : r.line21,
          line22: cash.line22 != null ? String(cash.line22) : r.line22,
          line23: cash.line23 != null ? String(cash.line23) : r.line23,
          line24: parts.line24 != null ? String(parts.line24) : r.line24,
          line25: parts.line25 != null ? String(parts.line25) : r.line25,
          line26: parts.line26 != null ? String(parts.line26) : r.line26,
          line27: parts.line27 != null ? String(parts.line27) : r.line27,
          line28: parts.line28 != null ? String(parts.line28) : r.line28,
          line29: parts.line29 != null ? String(parts.line29) : r.line29,
          line30: parts.line30 != null ? String(parts.line30) : r.line30,
          line31: parts.line31 != null ? String(parts.line31) : r.line31,
          paperNotes: data.notes != null ? String(data.notes) : r.paperNotes,
          questionnaire: data.questionnaire ? { ...data.questionnaire } : r.questionnaire,
          projections: data.projections ? projectionsFromSaved(data.projections) : r.projections,
          attachments: data.attachments ? { ...defaultAttachments(), ...data.attachments } : r.attachments
        };
      });
      var ex = data.exhibitC || {};
      setLastQbo(ex.qbo || null);
      setLastPaste(ex.paste || null);
      setExhibitD(
        data.exhibitD && data.exhibitD.length
          ? data.exhibitD.map(function (x) {
              return { ...x };
            })
          : [{ date: '', payee: '', amount: '', memo: '' }]
      );
    }

    async function fetchPriorOpening() {
      try {
        var r = await fetch(
          '/api/form-425c/prior-balance?' +
            new URLSearchParams({ companyId: repCompany, month: repMonth })
        );
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Request failed');
        if (d.line23 != null && d.line23 !== '') {
          setReport(function (r0) {
            return { ...r0, line19: String(d.line23) };
          });
          setReceiptMsg('Line 19 set from prior month ' + (d.priorMonth || '') + ' ending cash (line 23).');
        } else setReceiptMsg('No saved report for prior month \u2014 enter line 19 manually.');
      } catch (e) {
        setReceiptMsg(String(e.message || e));
      }
    }

    async function saveReportToServer() {
      if (!repCompany || !repMonth) {
        alert('Select company and month.');
        return;
      }
      var body = { companyId: repCompany, month: repMonth, ...gatherReportPayload() };
      try {
        var r = await fetch('/api/form-425c/saved-report', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || (await r.text()));
        setReceiptMsg('Report saved for ' + repMonth + '.');
        refreshHistory();
      } catch (e) {
        alert(String(e.message || e));
      }
    }

    async function loadSavedReport(companyId, month) {
      var r = await fetch(
        '/api/form-425c/saved-report?' + new URLSearchParams({ companyId: companyId, month: month })
      );
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Not found');
      var rep = d.report;
      setRepCompany(rep.companyId || companyId);
      setRepMonth(rep.month || month);
      applyReportPayload(rep);
    }

    async function parseQBPaste() {
      setQbPasteMsg('Parsing\u2026');
      try {
        var r = await fetch('/api/form-425c/parse-qb-paste', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: pasteText, companyId: qbCompany || repCompany })
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Parse failed');
        setLastPaste(d);
        setQbPasteMsg((d.meta && d.meta.message) || 'Parsed.');
      } catch (e) {
        setQbPasteMsg(String(e.message || e));
      }
    }

    function applyPasteToLine20() {
      if (!lastPaste || lastPaste.total == null) {
        alert('Parse a paste first.');
        return;
      }
      setReport(function (r) {
        return { ...r, line20: String(lastPaste.total) };
      });
      setLastQbo(null);
      setReceiptMsg('Line 20 and Exhibit C updated from paste (total $' + lastPaste.total + ').');
      setTab('report');
    }

    async function loadReceipts() {
      setReceiptMsg('Loading\u2026');
      try {
        var r = await fetch(
          '/api/form-425c/receipts?' + new URLSearchParams({ companyId: repCompany, month: repMonth })
        );
        var d = await r.json();
        if (d.error) throw new Error(d.error);
        setLastQbo(d);
        setLastPaste(null);
        setReport(function (r0) {
          return { ...r0, line20: d.line20Total != null ? String(d.line20Total) : r0.line20 };
        });
        setReceiptMsg(
          'Exhibit C: ' +
            (d.exhibitCLines || []).length +
            ' line(s) \u00b7 Total $' +
            d.line20Total +
            ' \u00b7 Deposits scanned: ' +
            d.depositsConsidered
        );
      } catch (e) {
        setReceiptMsg(String(e.message || e));
      }
    }

    function syncLine21FromExhibitD() {
      var sum = 0;
      exhibitD.forEach(function (row) {
        sum += parseFloat(String(row.amount || '').replace(/,/g, '')) || 0;
      });
      sum = Math.round(sum * 100) / 100;
      setReport(function (r) {
        return { ...r, line21: sum ? String(sum) : '' };
      });
    }

    async function downloadPackageZip() {
      var inp = mergeRef.current;
      if (!inp || !inp.files || !inp.files.length) {
        setMergeMsg('Choose at least one PDF (or other file) to include.');
        return;
      }
      var fd = new FormData();
      for (var i = 0; i < inp.files.length; i++) {
        fd.append('files', inp.files[i], inp.files[i].name);
      }
      fd.append(
        'manifestJson',
        JSON.stringify({
          companyId: repCompany,
          month: repMonth,
          attachmentsChecklist: report.attachments,
          generatedWith: 'IH35 Form 425C workspace'
        })
      );
      setMergeMsg('Building ZIP\u2026');
      try {
        var r = await fetch('/api/form-425c/package', { method: 'POST', body: fd });
        if (!r.ok) {
          var errJ = await r.json().catch(function () {
            return {};
          });
          throw new Error(errJ.error || r.statusText);
        }
        var blob = await r.blob();
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'IH35-Form425C-package.zip';
        a.click();
        URL.revokeObjectURL(a.href);
        setMergeMsg('Download started.');
      } catch (e) {
        setMergeMsg(String(e.message || e));
      }
    }

    function tabBtn(id, label) {
      return h(
        'button',
        {
          type: 'button',
          className: 'f425-tabs-btn' + (tab === id ? ' active' : ''),
          role: 'tab',
          'aria-selected': tab === id ? 'true' : 'false',
          onClick: function () {
            setTab(id);
          }
        },
        label
      );
    }

    function companyOptions() {
      return (profiles.companies || []).map(function (c) {
        return h('option', { key: c.id, value: c.id }, c.displayName || c.id);
      });
    }

    function renderProfilePanel() {
      return h(
        'section',
        { id: 'panel-profile', className: 'f425-panel' + (tab === 'profile' ? ' active' : '') },
        h('h2', { className: 'f425-h2' }, 'Debtor profiles, bank mapping & default questionnaire'),
        h(
          'div',
          { className: 'f425-actions no-print' },
          h(
            'button',
            { type: 'button', className: 'btn primary', onClick: loadBanks },
            'Refresh QuickBooks bank list'
          ),
          h(
            'button',
            { type: 'button', className: 'btn primary', onClick: saveProfiles },
            'Save profiles'
          )
        ),
        h('p', { className: 'f425-note' }, bankLoadMsg),
        (profiles.companies || []).map(function (c) {
          var hints = (c.bankPasteHints || []).join(', ');
          return h(
            'div',
            { key: c.id, className: 'f425-company-card' },
            h(
              'h3',
              null,
              escapeHtml(c.displayName || c.id),
              ' ',
              h('code', { style: { fontWeight: 400 } }, c.id)
            ),
            h(
              'div',
              { className: 'f425-grid' },
              h(
                'label',
                null,
                'Display name',
                h('input', {
                  value: c.displayName || '',
                  onChange: function (e) {
                    patchCompany(c.id, { displayName: e.target.value });
                  }
                })
              ),
              h(
                'label',
                null,
                'Debtor name (425C header)',
                h('input', {
                  value: c.debtorName || '',
                  onChange: function (e) {
                    patchCompany(c.id, { debtorName: e.target.value });
                  }
                })
              ),
              h(
                'label',
                null,
                'Case number',
                h('input', {
                  value: c.caseNumber || '',
                  onChange: function (e) {
                    patchCompany(c.id, { caseNumber: e.target.value });
                  }
                })
              ),
              h(
                'label',
                null,
                'Court district',
                h('input', {
                  value: c.courtDistrict || '',
                  onChange: function (e) {
                    patchCompany(c.id, { courtDistrict: e.target.value });
                  }
                })
              ),
              h(
                'label',
                null,
                'Court division',
                h('input', {
                  value: c.courtDivision || '',
                  onChange: function (e) {
                    patchCompany(c.id, { courtDivision: e.target.value });
                  }
                })
              ),
              h(
                'label',
                null,
                'NAICS',
                h('input', {
                  value: c.naicsCode || '',
                  onChange: function (e) {
                    patchCompany(c.id, { naicsCode: e.target.value });
                  }
                })
              ),
              h(
                'label',
                null,
                'Line of business',
                h('input', {
                  value: c.lineOfBusiness || '',
                  onChange: function (e) {
                    patchCompany(c.id, { lineOfBusiness: e.target.value });
                  }
                })
              ),
              h(
                'label',
                null,
                'Responsible party',
                h('input', {
                  value: c.responsiblePartyName || '',
                  onChange: function (e) {
                    patchCompany(c.id, { responsiblePartyName: e.target.value });
                  }
                })
              )
            ),
            h(
              'label',
              { style: { display: 'block', marginTop: 10, fontSize: 12, color: 'var(--color-text-label)' } },
              'QB paste filter hints (comma-separated)',
              h('textarea', {
                rows: 2,
                style: { width: '100%', marginTop: 4, padding: 8, borderRadius: 6, font: 'inherit' },
                value: hints,
                onChange: function (e) {
                  var parts = e.target.value
                    .split(/[,;\n]+/)
                    .map(function (s) {
                      return s.trim();
                    })
                    .filter(Boolean);
                  patchCompany(c.id, { bankPasteHints: parts });
                }
              })
            ),
            h(
              'p',
              { className: 'f425-note' },
              'Select QuickBooks ',
              h('strong', null, 'Bank'),
              ' accounts for this debtor.'
            ),
            h(
              'div',
              { className: 'f425-bank-pick' },
              !banks.length
                ? h(
                    'span',
                    { className: 'f425-note' },
                    'Click ',
                    h('strong', null, 'Refresh QuickBooks bank list'),
                    ' to map accounts.'
                  )
                : banks.map(function (a) {
                    var checked = new Set((c.bankAccountQboIds || []).map(String)).has(String(a.id));
                    return h(
                      'label',
                      { key: a.id },
                      h('input', {
                        type: 'checkbox',
                        checked: checked,
                        onChange: function (e) {
                          toggleBank(c.id, a.id, e.target.checked);
                        }
                      }),
                      h(
                        'span',
                        null,
                        a.name,
                        ' ',
                        h('code', null, a.id),
                        a.currentBalance != null ? ' \u00b7 Bal ' + a.currentBalance : ''
                      )
                    );
                  })
            ),
            h(
              'label',
              { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: !!c.includeUnclassifiedDepositLines,
                onChange: function (e) {
                  patchCompany(c.id, { includeUnclassifiedDepositLines: e.target.checked });
                }
              }),
              'Include deposit lines with no linked txn (review manually)'
            ),
            h(
              'label',
              { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
              h('input', {
                type: 'checkbox',
                checked: !!c.includeJournalEntryDepositLines,
                onChange: function (e) {
                  patchCompany(c.id, { includeJournalEntryDepositLines: e.target.checked });
                }
              }),
              'Include lines linked to JournalEntry'
            ),
            h(
              'details',
              { style: { marginTop: 12 } },
              h(
                'summary',
                { className: 'f425-note', style: { cursor: 'pointer', fontWeight: 600 } },
                'Default questionnaire (lines 1\u201318)'
              ),
              h(
                'div',
                {
                  style: {
                    marginTop: 10,
                    padding: 10,
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    background: 'var(--color-bg-card)'
                  }
                },
                Q_LINES.map(function (ql) {
                  var n = ql[0];
                  var txt = ql[1];
                  var v = (c.defaultQuestionnaire || {})[String(n)] || 'Yes';
                  return h(
                    'div',
                    { key: n, className: 'f425-yn-row', style: { fontSize: 12 } },
                    h('span', { style: { minWidth: 140 } }, 'Line ' + n),
                    h(
                      'label',
                      null,
                      h('input', {
                        type: 'radio',
                        name: 'defq-' + c.id + '-' + n,
                        checked: v === 'Yes',
                        onChange: function () {
                          patchCompanyDefQ(c.id, n, 'Yes');
                        }
                      }),
                      ' Yes'
                    ),
                    h(
                      'label',
                      null,
                      h('input', {
                        type: 'radio',
                        name: 'defq-' + c.id + '-' + n,
                        checked: v === 'No',
                        onChange: function () {
                          patchCompanyDefQ(c.id, n, 'No');
                        }
                      }),
                      ' No'
                    ),
                    h(
                      'label',
                      null,
                      h('input', {
                        type: 'radio',
                        name: 'defq-' + c.id + '-' + n,
                        checked: v === 'N/A',
                        onChange: function () {
                          patchCompanyDefQ(c.id, n, 'N/A');
                        }
                      }),
                      ' N/A'
                    ),
                    h('span', { style: { flex: '1 1 100%', fontSize: 11, color: 'var(--color-text-label)' } }, txt)
                  );
                })
              )
            )
          );
        })
      );
    }

    function renderQbImportPanel() {
      var pasteRows = (lastPaste && lastPaste.rows) || [];
      return h(
        'section',
        { id: 'panel-qbimport', className: 'f425-panel' + (tab === 'qbimport' ? ' active' : '') },
        h('h2', { className: 'f425-h2' }, 'Paste QuickBooks deposit / register export'),
        h(
          'p',
          { className: 'f425-note' },
          'Transfers excluded; income-like deposits kept. Profile paste hints filter the bank/split column.'
        ),
        h(
          'div',
          { className: 'f425-grid', style: { marginBottom: 12 } },
          h(
            'label',
            null,
            'Debtor profile',
            h(
              'select',
              {
                value: qbCompany,
                onChange: function (e) {
                  setQbCompany(e.target.value);
                }
              },
              companyOptions()
            )
          )
        ),
        h(
          'label',
          { style: { display: 'block', fontSize: 12, color: 'var(--color-text-label)' } },
          'Paste export',
          h('textarea', {
            rows: 12,
            style: { width: '100%', marginTop: 4, fontFamily: 'ui-monospace,monospace', fontSize: 11 },
            value: pasteText,
            onChange: function (e) {
              setPasteText(e.target.value);
            }
          })
        ),
        h(
          'div',
          { className: 'f425-actions no-print' },
          h(
            'button',
            { type: 'button', className: 'btn primary', onClick: parseQBPaste },
            'Parse paste'
          ),
          h(
            'button',
            { type: 'button', className: 'btn secondary', onClick: applyPasteToLine20 },
            'Apply total to line 20 & Exhibit C'
          )
        ),
        h('p', { className: 'f425-note' }, qbPasteMsg),
        h(
          'table',
          { className: 'f425-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h('th', null, 'Date'),
              h('th', null, 'Type'),
              h('th', null, 'Amount'),
              h('th', null, 'Split'),
              h('th', null, 'Name'),
              h('th', null, 'Memo')
            )
          ),
          h(
            'tbody',
            null,
            !pasteRows.length
              ? h(
                  'tr',
                  null,
                  h('td', { colSpan: 6, className: 'f425-note' }, 'Parse a paste to preview rows.')
                )
              : pasteRows.map(function (row, ix) {
                  return h(
                    'tr',
                    { key: ix },
                    h('td', null, row.date),
                    h('td', null, row.type),
                    h('td', { className: 'f425-money' }, String(row.amount)),
                    h('td', null, row.split),
                    h('td', null, row.name),
                    h('td', null, row.memo)
                  );
                })
          )
        )
      );
    }

    var exhibitCLines = lastQbo
      ? lastQbo.exhibitCLines || []
      : lastPaste
        ? lastPaste.rows || []
        : [];
    var isPasteC = !lastQbo && !!lastPaste;

    function renderReportPanel() {
      return h(
        'section',
        { id: 'panel-report', className: 'f425-panel' + (tab === 'report' ? ' active' : '') },
        h('h2', { className: 'f425-h2' }, 'Form 425C \u2014 working copy'),
        h(
          'div',
          { className: 'f425-grid', style: { marginBottom: 12 } },
          h(
            'label',
            null,
            'Debtor profile',
            h(
              'select',
              {
                value: repCompany,
                onChange: function (e) {
                  var id = e.target.value;
                  setRepCompany(id);
                  applySelectedProfileToPaper(id);
                }
              },
              companyOptions()
            )
          ),
          h(
            'label',
            null,
            'Report month',
            h('input', {
              type: 'month',
              value: repMonth,
              onChange: function (e) {
                setRepMonth(e.target.value);
              }
            })
          )
        ),
        h(
          'div',
          { className: 'f425-actions no-print' },
          h(
            'button',
            { type: 'button', className: 'btn primary', onClick: loadReceipts },
            'Load Exhibit C from QuickBooks'
          ),
          h(
            'button',
            { type: 'button', className: 'btn secondary', onClick: fetchPriorOpening },
            'Carry line 19 from prior saved month'
          ),
          h(
            'button',
            { type: 'button', className: 'btn secondary', onClick: applyQDefaults },
            'Apply profile questionnaire defaults'
          ),
          h(
            'button',
            { type: 'button', className: 'btn primary', onClick: saveReportToServer },
            'Save report'
          ),
          h('button', { type: 'button', className: 'btn secondary', onClick: function () { window.print(); } }, 'Print / Save as PDF')
        ),
        h('p', { className: 'f425-note' }, receiptMsg),
        h(
          'div',
          { className: 'f425-paper' },
          h(
            'p',
            { style: { fontSize: 11, color: 'var(--color-text-label)', margin: '0 0 8px' } },
            h('strong', null, 'Official Form 425C'),
            ' \u00b7 Monthly Operating Report for Small Business Under Chapter 11'
          ),
          h(
            'div',
            { className: 'f425-grid' },
            h(
              'label',
              null,
              'Month',
              h('input', {
                type: 'text',
                placeholder: monthPlaceholder || 'e.g. March 2026',
                value: report.paperMonth,
                onChange: function (e) {
                  setReport(function (r) {
                    return { ...r, paperMonth: e.target.value };
                  });
                }
              })
            ),
            h(
              'label',
              null,
              'Date report filed',
              h('input', {
                type: 'date',
                value: report.paperFiled,
                onChange: function (e) {
                  setReport(function (r) {
                    return { ...r, paperFiled: e.target.value };
                  });
                }
              })
            ),
            h(
              'label',
              null,
              'Line of business',
              h('input', {
                value: report.paperLob,
                onChange: function (e) {
                  setReport(function (r) {
                    return { ...r, paperLob: e.target.value };
                  });
                }
              })
            ),
            h(
              'label',
              null,
              'NAICS code',
              h('input', {
                value: report.paperNaics,
                onChange: function (e) {
                  setReport(function (r) {
                    return { ...r, paperNaics: e.target.value };
                  });
                }
              })
            )
          ),
          h(
            'label',
            { style: { display: 'block', marginTop: 10, fontSize: 12, color: 'var(--color-text-label)' } },
            'Responsible party (printed name)',
            h('input', {
              style: { width: '100%', maxWidth: 640 },
              value: report.paperRp,
              onChange: function (e) {
                setReport(function (r) {
                  return { ...r, paperRp: e.target.value };
                });
              }
            })
          ),
          h('h3', { className: 'f425-h3' }, 'Part 1 \u2014 Questionnaire (lines 1\u201318)'),
          h(
            'p',
            { className: 'f425-note' },
            'Yes / No / N/A per line. Attach Exhibit A/B as required.'
          ),
          Q_LINES.map(function (ql) {
            var n = ql[0];
            var txt = ql[1];
            var cur = report.questionnaire[String(n)] || '';
            return h(
              'div',
              { key: n, className: 'f425-yn-row' },
              h('span', { style: { minWidth: 220 } }, n + '. ' + txt),
              h(
                'label',
                null,
                h('input', {
                  type: 'radio',
                  name: 'q' + n,
                  checked: cur === 'Yes',
                  onChange: function () {
                    setQ(n, 'Yes');
                  }
                }),
                ' Yes'
              ),
              h(
                'label',
                null,
                h('input', {
                  type: 'radio',
                  name: 'q' + n,
                  checked: cur === 'No',
                  onChange: function () {
                    setQ(n, 'No');
                  }
                }),
                ' No'
              ),
              h(
                'label',
                null,
                h('input', {
                  type: 'radio',
                  name: 'q' + n,
                  checked: cur === 'N/A',
                  onChange: function () {
                    setQ(n, 'N/A');
                  }
                }),
                ' N/A'
              )
            );
          }),
          h('h3', { className: 'f425-h3' }, 'Debtor / case'),
          h(
            'div',
            { className: 'f425-grid' },
            h(
              'label',
              null,
              'Debtor name',
              h('input', {
                value: report.paperDebtor,
                onChange: function (e) {
                  setReport(function (r) {
                    return { ...r, paperDebtor: e.target.value };
                  });
                }
              })
            ),
            h(
              'label',
              null,
              'Case number',
              h('input', {
                value: report.paperCase,
                onChange: function (e) {
                  setReport(function (r) {
                    return { ...r, paperCase: e.target.value };
                  });
                }
              })
            ),
            h(
              'label',
              null,
              'Bankruptcy court',
              h('input', {
                placeholder: 'e.g. Southern \u00b7 Texas',
                value: report.paperCourt,
                onChange: function (e) {
                  setReport(function (r) {
                    return { ...r, paperCourt: e.target.value };
                  });
                }
              })
            )
          ),
          h('h3', { className: 'f425-h3' }, 'Part 2 \u2014 Cash summary (lines 19\u201323)'),
          h(
            'div',
            { className: 'f425-grid' },
            ['line19', 'line20', 'line21'].map(function (key, i) {
              var labels = [
                '19. Total opening balance (all accounts)',
                '20. Total cash receipts (Exhibit C)',
                '21. Total cash disbursements (Exhibit D)'
              ];
              return h(
                'label',
                { key: key },
                labels[i],
                h('input', {
                  className: 'f425-money',
                  inputMode: 'decimal',
                  value: report[key],
                  onChange: function (e) {
                    var k = key;
                    var v = e.target.value;
                    setReport(function (r) {
                      return { ...r, [k]: v };
                    });
                  }
                })
              );
            }),
            h(
              'label',
              null,
              '22. Net cash flow',
              h('input', {
                className: 'f425-money',
                readOnly: true,
                value: report.line22
              })
            ),
            h(
              'label',
              null,
              '23. Ending cash',
              h('input', {
                className: 'f425-money',
                readOnly: true,
                value: report.line23
              })
            )
          ),
          h('h3', { className: 'f425-h3' }, 'Exhibit C \u2014 Cash receipts'),
          h(
            'table',
            { className: 'f425-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, 'Deposit date'),
                h('th', null, 'Bank / split'),
                h('th', null, 'Amount'),
                h('th', null, 'Type / linked'),
                h('th', null, 'Reference')
              )
            ),
            h(
              'tbody',
              null,
              !exhibitCLines.length
                ? h(
                    'tr',
                    null,
                    h(
                      'td',
                      { colSpan: 5, className: 'f425-note' },
                      'Load from QuickBooks or use QB import tab.'
                    )
                  )
                : exhibitCLines.map(function (row, ix) {
                    if (isPasteC) {
                      return h(
                        'tr',
                        { key: ix },
                        h('td', null, row.date),
                        h('td', null, row.split || ''),
                        h('td', { className: 'f425-money' }, String(row.amount)),
                        h('td', null, row.type || ''),
                        h('td', null, [row.name, row.memo].filter(Boolean).join(' \u00b7 '))
                      );
                    }
                    return h(
                      'tr',
                      { key: ix },
                      h('td', null, row.depositTxnDate),
                      h('td', null, row.bankAccountName || row.bankAccountId),
                      h('td', { className: 'f425-money' }, String(row.lineAmount)),
                      h('td', null, (row.linkedTxnTypes || []).join(', ')),
                      h('td', null, String(row.depositId))
                    );
                  })
            )
          ),
          h('h3', { className: 'f425-h3' }, 'Exhibit D \u2014 Disbursements'),
          h(
            'p',
            { className: 'f425-note no-print' },
            'Add rows; ',
            h('strong', null, 'Recalc line 21'),
            ' sums amounts.'
          ),
          h(
            'div',
            { className: 'f425-actions no-print' },
            h(
              'button',
              {
                type: 'button',
                className: 'btn secondary',
                onClick: function () {
                  setExhibitD(
                    exhibitD.concat([{ date: '', payee: '', amount: '', memo: '' }])
                  );
                }
              },
              'Add row'
            ),
            h(
              'button',
              { type: 'button', className: 'btn secondary', onClick: syncLine21FromExhibitD },
              'Recalc line 21 from Exhibit D'
            )
          ),
          h(
            'table',
            { className: 'f425-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, 'Date'),
                h('th', null, 'Payee'),
                h('th', null, 'Amount'),
                h('th', null, 'Memo'),
                h('th', { className: 'no-print' }, '')
              )
            ),
            h(
              'tbody',
              null,
              exhibitD.map(function (row, ix) {
                return h(
                  'tr',
                  { key: ix },
                  h(
                    'td',
                    null,
                    h('input', {
                      style: { width: '100%', boxSizing: 'border-box' },
                      value: row.date,
                      onChange: function (e) {
                        var v = e.target.value;
                        setExhibitD(
                          exhibitD.map(function (r, j) {
                            return j === ix ? { ...r, date: v } : r;
                          })
                        );
                      }
                    })
                  ),
                  h(
                    'td',
                    null,
                    h('input', {
                      style: { width: '100%', boxSizing: 'border-box' },
                      value: row.payee,
                      onChange: function (e) {
                        var v = e.target.value;
                        setExhibitD(
                          exhibitD.map(function (r, j) {
                            return j === ix ? { ...r, payee: v } : r;
                          })
                        );
                      }
                    })
                  ),
                  h(
                    'td',
                    null,
                    h('input', {
                      className: 'f425-money',
                      inputMode: 'decimal',
                      style: { width: '100%', boxSizing: 'border-box' },
                      value: row.amount,
                      onChange: function (e) {
                        var v = e.target.value;
                        setExhibitD(
                          exhibitD.map(function (r, j) {
                            return j === ix ? { ...r, amount: v } : r;
                          })
                        );
                      }
                    })
                  ),
                  h(
                    'td',
                    null,
                    h('input', {
                      style: { width: '100%', boxSizing: 'border-box' },
                      value: row.memo,
                      onChange: function (e) {
                        var v = e.target.value;
                        setExhibitD(
                          exhibitD.map(function (r, j) {
                            return j === ix ? { ...r, memo: v } : r;
                          })
                        );
                      }
                    })
                  ),
                  h(
                    'td',
                    { className: 'no-print' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'btn secondary',
                        onClick: function () {
                          if (exhibitD.length <= 1) return;
                          setExhibitD(
                            exhibitD.filter(function (_, j) {
                              return j !== ix;
                            })
                          );
                        }
                      },
                      'Remove'
                    )
                  )
                );
              })
            )
          ),
          h('h3', { className: 'f425-h3' }, 'Parts 3\u20136'),
          h(
            'div',
            { className: 'f425-grid' },
            [
              ['line24', '24. Total payables'],
              ['line25', '25. Total receivables'],
              ['line26', '26. Employees when case filed'],
              ['line27', '27. Employees as of report date'],
              ['line28', '28. Professional fees (bankruptcy) this month'],
              ['line29', '29. Professional fees (bankruptcy) since filing'],
              ['line30', '30. Other professional fees this month'],
              ['line31', '31. Other professional fees since filing']
            ].map(function (pair) {
              var k = pair[0];
              var lab = pair[1];
              var money =
                k !== 'line26' && k !== 'line27';
              return h(
                'label',
                { key: k },
                lab,
                h('input', {
                  className: money ? 'f425-money' : '',
                  value: report[k],
                  onChange: function (e) {
                    var key = k;
                    var v = e.target.value;
                    setReport(function (r) {
                      return { ...r, [key]: v };
                    });
                  }
                })
              );
            })
          ),
          h('h3', { className: 'f425-h3' }, 'Part 7 \u2014 Projections'),
          h(
            'table',
            { className: 'f425-table f425-proj-table', style: { tableLayout: 'fixed', width: '100%' } },
            h(
              'colgroup',
              null,
              h('col', { style: { width: '28%' } }),
              h('col', { style: { width: '24%' } }),
              h('col', { style: { width: '24%' } }),
              h('col', { style: { width: '24%' } })
            ),
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, 'Line / description'),
                h('th', { style: { textAlign: 'center' } }, 'Prior month'),
                h('th', { style: { textAlign: 'center' } }, 'This month'),
                h('th', { style: { textAlign: 'center' } }, 'Next month (proj.)')
              )
            ),
            h(
              'tbody',
              null,
              PROJ_ROWS.map(function (pr) {
                var code = pr[0];
                var label = pr[1];
                var pj = report.projections[code] || { prior: '', current: '', next: '' };
                return h(
                  'tr',
                  { key: code },
                  h(
                    'td',
                    null,
                    h('strong', null, code),
                    ' \u00b7 ',
                    label
                  ),
                  h(
                    'td',
                    null,
                    h('input', {
                      value: pj.prior,
                      onChange: function (e) {
                        var v = e.target.value;
                        setReport(function (r) {
                          var proj = { ...r.projections };
                          proj[code] = { ...proj[code], prior: v };
                          return { ...r, projections: proj };
                        });
                      }
                    })
                  ),
                  h(
                    'td',
                    null,
                    h('input', {
                      value: pj.current,
                      onChange: function (e) {
                        var v = e.target.value;
                        setReport(function (r) {
                          var proj = { ...r.projections };
                          proj[code] = { ...proj[code], current: v };
                          return { ...r, projections: proj };
                        });
                      }
                    })
                  ),
                  h(
                    'td',
                    null,
                    h('input', {
                      value: pj.next,
                      onChange: function (e) {
                        var v = e.target.value;
                        setReport(function (r) {
                          var proj = { ...r.projections };
                          proj[code] = { ...proj[code], next: v };
                          return { ...r, projections: proj };
                        });
                      }
                    })
                  )
                );
              })
            )
          ),
          h('h3', { className: 'f425-h3' }, 'Part 8 \u2014 Attachment checklist'),
          ATTACH_KEYS.map(function (ak) {
            var key = ak[0];
            var lab = ak[1];
            return h(
              'label',
              {
                key: key,
                style: { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0', fontSize: 13 }
              },
              h('input', {
                type: 'checkbox',
                checked: !!report.attachments[key],
                onChange: function (e) {
                  var on = e.target.checked;
                  setReport(function (r) {
                    var att = { ...r.attachments };
                    att[key] = on;
                    return { ...r, attachments: att };
                  });
                }
              }),
              ' ',
              lab
            );
          }),
          h(
            'label',
            { style: { display: 'block', marginTop: 14, fontSize: 12, color: 'var(--color-text-label)' } },
            'Notes / other attachments',
            h('textarea', {
              rows: 3,
              style: { width: '100%', marginTop: 4 },
              value: report.paperNotes,
              onChange: function (e) {
                setReport(function (r) {
                  return { ...r, paperNotes: e.target.value };
                });
              }
            })
          )
        ),
        h(
          'h3',
          { className: 'f425-h2 no-print', style: { marginTop: 20 } },
          'Transfers in period (informational)'
        ),
        h(
          'table',
          { className: 'f425-table no-print' },
          h(
            'thead',
            null,
            h('tr', null, h('th', null, 'Date'), h('th', null, 'From'), h('th', null, 'To'), h('th', null, 'Amount'))
          ),
          h(
            'tbody',
            null,
            !(lastQbo && (lastQbo.transfersInPeriod || []).length)
              ? h('tr', null, h('td', { colSpan: 4 }, '\u2014'))
              : (lastQbo.transfersInPeriod || []).map(function (t, ix) {
                  return h(
                    'tr',
                    { key: ix },
                    h('td', null, t.txnDate),
                    h('td', null, String(t.from || '')),
                    h('td', null, String(t.to || '')),
                    h('td', { className: 'f425-money' }, String(t.amount))
                  );
                })
          )
        )
      );
    }

    function renderMergePanel() {
      return h(
        'section',
        { id: 'panel-merge', className: 'f425-panel' + (tab === 'merge' ? ' active' : '') },
        h('h2', { className: 'f425-h2' }, 'Merge & export \u2014 filing package (.zip)'),
        h(
          'p',
          { className: 'f425-note' },
          'Upload PDFs; package-manifest.json includes company, month, and checklist.'
        ),
        h(
          'label',
          { style: { display: 'block', fontSize: 13 } },
          'Files to include',
          h('input', {
            ref: mergeRef,
            type: 'file',
            multiple: true,
            accept: 'application/pdf,.pdf',
            className: 'no-print',
            style: { marginTop: 6 }
          })
        ),
        h(
          'div',
          { className: 'f425-actions' },
          h(
            'button',
            { type: 'button', className: 'btn primary', onClick: downloadPackageZip },
            'Download ZIP package'
          )
        ),
        h('p', { className: 'f425-note' }, mergeMsg)
      );
    }

    function renderHistoryPanel() {
      return h(
        'section',
        { id: 'panel-history', className: 'f425-panel' + (tab === 'history' ? ' active' : '') },
        h('h2', { className: 'f425-h2' }, 'Saved reports'),
        h(
          'div',
          { className: 'f425-actions no-print' },
          h(
            'button',
            { type: 'button', className: 'btn secondary', onClick: refreshHistory },
            'Refresh list'
          )
        ),
        !historyList.length
          ? h('p', { className: 'f425-note' }, 'No saved reports yet.')
          : h(
              'table',
              { className: 'f425-table' },
              h(
                'thead',
                null,
                h(
                  'tr',
                  null,
                  h('th', null, 'Company'),
                  h('th', null, 'Month'),
                  h('th', null, 'Updated'),
                  h('th', { className: 'no-print' }, '')
                )
              ),
              h(
                'tbody',
                null,
                historyList.map(function (row) {
                  return h(
                    'tr',
                    { key: row.companyId + '-' + row.month },
                    h('td', null, row.companyId),
                    h('td', null, row.month),
                    h('td', null, row.updatedAt || ''),
                    h(
                      'td',
                      { className: 'no-print' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'btn primary',
                          onClick: async function () {
                            try {
                              await loadSavedReport(row.companyId, row.month);
                              setTab('report');
                              setReceiptMsg('Loaded saved report.');
                            } catch (e) {
                              alert(String(e.message || e));
                            }
                          }
                        },
                        'Load'
                      )
                    )
                  );
                })
              )
            )
      );
    }

    return h(
      'div',
      { className: 'form-425c-root' },
      h(
        'div',
        { className: 'form-425c-wrap' },
        h(
          'p',
          { className: 'no-print', style: { fontSize: 12 } },
          h('a', { href: '/' }, '\u2190 Company home'),
          ' \u00b7 ',
          h('a', { href: '/maintenance.html' }, 'ERP'),
          ' \u00b7 ',
          h('a', { href: '/form-425c-demo.html' }, 'Filled sample (demo)')
        ),
        h(
          'h1',
          { style: { margin: '8px 0 4px', fontSize: '1.35rem', color: 'var(--color-text-primary)' } },
          'Official Form 425C \u2014 Monthly operating report'
        ),
        h(
          'p',
          { className: 'f425-note no-print' },
          'IH 35 Transportation LLC and IH 35 Trucking LLC \u2014 Chapter 11 workspace. QB import excludes transfers; History saves JSON per month.'
        ),
        h(
          'div',
          { className: 'f425-tabs no-print', role: 'tablist' },
          tabBtn('profile', 'Profiles & defaults'),
          tabBtn('qbimport', 'QB import'),
          tabBtn('report', 'Form 425C'),
          tabBtn('merge', 'Merge & export'),
          tabBtn('history', 'History')
        ),
        renderProfilePanel(),
        renderQbImportPanel(),
        renderReportPanel(),
        renderMergePanel(),
        renderHistoryPanel()
      )
    );
  }

  window.Form425CApp = Form425CApp;
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Form425CApp, null));
})();
