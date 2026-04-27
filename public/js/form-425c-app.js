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
    ['32', 'Projected/Actual gross receipts / cash inflows'],
    ['33', 'Projected/Actual total cash disbursements']
  ];
  var ATTACH_KEYS = [
    ['pl', 'Profit & loss (month)'],
    ['bs', 'Balance sheet'],
    ['bankStmt', 'Bank statements (all DIP accounts)'],
    ['bankRec', 'Bank reconciliation worksheets'],
    ['ar', 'Accounts receivable aging'],
    ['ap', 'Accounts payable / unpaid bills detail'],
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
      nextMonthProjectedReceipts: '',
      nextMonthProjectedDisbursements: '',
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

    var repCoState = React.useState('ih35-transportation');
    var repCompany = repCoState[0];
    var setRepCompany = repCoState[1];

    var repMoState = React.useState('');
    var repMonth = repMoState[0];
    var setRepMonth = repMoState[1];

    var qbCoState = React.useState('ih35-transportation');
    var qbCompany = qbCoState[0];
    var setQbCompany = qbCoState[1];
    var lastLoadedLocalKeyRef = React.useRef('');

    function normalizeCompanyId(raw) {
      return String(raw || '').trim().toLowerCase();
    }

    function localReportKey(companyId, month) {
      var c = normalizeCompanyId(companyId);
      var m = String(month || '').trim();
      if (!c || !m) return '';
      return 'form425c_' + c + '_' + m;
    }

    function fmtAccounting(val) {
      var n = parseFloat(String(val).replace(/[$,()]/g, '').trim());
      if (isNaN(n)) return '';
      if (n < 0) return '($' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ')';
      return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function unFmt(val) {
      var raw = String(val == null ? '' : val).trim();
      if (!raw) return 0;
      var negParen = /^\(.*\)$/.test(raw);
      var cleaned = raw.replace(/[$,()]/g, '');
      var n = parseFloat(cleaned);
      if (isNaN(n)) return 0;
      return negParen ? -Math.abs(n) : n;
    }

    function toNumber(v) {
      return unFmt(v);
    }

    function normalizeMoneyInput(v) {
      var s = String(v == null ? '' : v).trim();
      if (!s) return '';
      var n = unFmt(s);
      return String(n);
    }

    function moneyDisplayValue(value, focused) {
      var s = String(value == null ? '' : value).trim();
      if (!s) return '';
      if (focused) return String(unFmt(s));
      return fmtAccounting(s);
    }

    var PROFILE_LOCAL_KEY = 'form425c_profiles';

    function safeJsonParse(raw) {
      try {
        return JSON.parse(String(raw || ''));
      } catch (_) {
        return null;
      }
    }

    function saveReportToLocal(companyId, month, payload) {
      var k = localReportKey(companyId, month);
      if (!k) return;
      var body = {
        companyId: companyId,
        month: month,
        savedAt: new Date().toISOString(),
        report: payload
      };
      localStorage.setItem(k, JSON.stringify(body));
      lastLoadedLocalKeyRef.current = k;
    }

    function loadReportFromLocal(companyId, month) {
      var k = localReportKey(companyId, month);
      if (!k) return null;
      var raw = localStorage.getItem(k);
      var parsed = safeJsonParse(raw);
      if (!parsed || !parsed.report) return null;
      return parsed;
    }

    function priorMonthIso(ym) {
      if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return '';
      var d = new Date(String(ym) + '-01T00:00:00');
      d.setMonth(d.getMonth() - 1);
      return d.toISOString().slice(0, 7);
    }

    function primePart7FromPriorMonth(companyId, month) {
      var prev = priorMonthIso(month);
      if (!prev) return false;
      var payload = loadReportFromLocal(companyId, prev);
      if (!payload || !payload.report) return false;
      var p = payload.report;
      var nextGross = String(p.nextMonthProjectedReceipts || '').trim();
      var nextDisb = String(p.nextMonthProjectedDisbursements || '').trim();
      if (!nextGross && !nextDisb) return false;
      setReport(function (r) {
        var proj = { ...r.projections };
        proj['32'] = { ...proj['32'], prior: nextGross || (proj['32'] && proj['32'].prior) || '' };
        proj['33'] = { ...proj['33'], prior: nextDisb || (proj['33'] && proj['33'].prior) || '' };
        return { ...r, projections: proj };
      });
      return true;
    }

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

    var plFileRef = React.useRef(null);
    var bankStmtRef = React.useRef(null);
    var bankRecRef = React.useRef(null);

    var mergeFilesState = React.useState({ pl: [], bankStmt: [], bankRec: [] });
    var mergeFiles = mergeFilesState[0];
    var setMergeFiles = mergeFilesState[1];

    var moneyFocusState = React.useState({});
    var moneyFocus = moneyFocusState[0];
    var setMoneyFocus = moneyFocusState[1];

    function setMoneyFieldFocus(fieldKey, on) {
      setMoneyFocus(function (m) {
        return { ...m, [fieldKey]: !!on };
      });
    }

    function makeMoneyInputProps(fieldKey, rawValue, onRawChange, readOnly) {
      return {
        className: 'f425-money' + (readOnly ? ' f425-calculated' : ''),
        inputMode: 'decimal',
        readOnly: !!readOnly,
        value: moneyDisplayValue(rawValue, !!moneyFocus[fieldKey]),
        onFocus: function () {
          if (readOnly) return;
          setMoneyFieldFocus(fieldKey, true);
        },
        onBlur: function (e) {
          if (readOnly) return;
          setMoneyFieldFocus(fieldKey, false);
          onRawChange(normalizeMoneyInput(e.target.value));
        },
        onChange: function (e) {
          if (readOnly) return;
          onRawChange(e.target.value);
        }
      };
    }

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
          var localSaved = safeJsonParse(localStorage.getItem(PROFILE_LOCAL_KEY));
          if (localSaved && Array.isArray(localSaved.companies)) {
            var byId = {};
            localSaved.companies.forEach(function (c) {
              if (c && c.id) byId[c.id] = c;
            });
            data = {
              ...data,
              companies: (data.companies || []).map(function (c) {
                var lc = byId[c.id] || {};
                return {
                  ...c,
                  caseNumber: lc.caseNumber != null ? lc.caseNumber : c.caseNumber,
                  courtDistrict: lc.courtDistrict != null ? lc.courtDistrict : c.courtDistrict,
                  courtDivision: lc.courtDivision != null ? lc.courtDivision : c.courtDivision,
                  responsiblePartyName:
                    lc.responsiblePartyName != null ? lc.responsiblePartyName : c.responsiblePartyName,
                  naicsCode: lc.naicsCode != null ? lc.naicsCode : c.naicsCode,
                  lineOfBusiness: lc.lineOfBusiness != null ? lc.lineOfBusiness : c.lineOfBusiness
                };
              })
            };
          }
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
          var localSavedOnly = safeJsonParse(localStorage.getItem(PROFILE_LOCAL_KEY));
          if (localSavedOnly && Array.isArray(localSavedOnly.companies)) {
            setProfiles(function (prev) {
              return {
                ...prev,
                companies: (prev.companies || []).length
                  ? prev.companies.map(function (c) {
                      var lc = (localSavedOnly.companies || []).find(function (x) {
                        return x.id === c.id;
                      }) || {};
                      return {
                        ...c,
                        caseNumber: lc.caseNumber != null ? lc.caseNumber : c.caseNumber,
                        courtDistrict: lc.courtDistrict != null ? lc.courtDistrict : c.courtDistrict,
                        courtDivision: lc.courtDivision != null ? lc.courtDivision : c.courtDivision,
                        responsiblePartyName:
                          lc.responsiblePartyName != null ? lc.responsiblePartyName : c.responsiblePartyName,
                        naicsCode: lc.naicsCode != null ? lc.naicsCode : c.naicsCode,
                        lineOfBusiness: lc.lineOfBusiness != null ? lc.lineOfBusiness : c.lineOfBusiness
                      };
                    })
                  : localSavedOnly.companies
              };
            });
          }
        }
      })();
      return function () {
        cancelled = true;
      };
    }, []);

    React.useEffect(function () {
      refreshHistory();
    }, []);

    React.useEffect(function () {
      if (!repCompany) return;
      if (qbCompany !== repCompany) setQbCompany(repCompany);
    }, [repCompany]);

    React.useEffect(function () {
      if (!repCompany || !repMonth) return;
      var k = localReportKey(repCompany, repMonth);
      if (!k || lastLoadedLocalKeyRef.current === k) return;
      var localSaved = loadReportFromLocal(repCompany, repMonth);
      if (localSaved && localSaved.report) {
        applyReportPayload(localSaved.report);
        setReceiptMsg('📂 Restored from ' + repMonth);
        if (typeof window.erpShowToast === 'function') window.erpShowToast('📂 Restored from ' + repMonth);
        lastLoadedLocalKeyRef.current = k;
        return;
      }

      var selectedCompany = (profiles.companies || []).find(function (c) {
        return c.id === repCompany;
      });
      setReport(function () {
        var fresh = defaultReportState();
        if (selectedCompany) {
          fresh.paperDebtor = selectedCompany.debtorName || '';
          fresh.paperCase = selectedCompany.caseNumber || '';
          fresh.paperCourt = [selectedCompany.courtDistrict, selectedCompany.courtDivision].filter(Boolean).join(' · ');
          fresh.paperNaics = selectedCompany.naicsCode || '';
          fresh.paperLob = selectedCompany.lineOfBusiness || '';
          fresh.paperRp = selectedCompany.responsiblePartyName || '';
          fresh.questionnaire = { ...(selectedCompany.defaultQuestionnaire || {}) };
        }
        return fresh;
      });
      setExhibitD([{ date: '', payee: '', amount: '', memo: '' }]);
      setLastQbo(null);
      setLastPaste(null);
      primePart7FromPriorMonth(repCompany, repMonth);
      setReceiptMsg('');
      lastLoadedLocalKeyRef.current = k;
    }, [repCompany, repMonth, profiles]);

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

    function switchDebtor(companyId) {
      var id = String(companyId || '').trim();
      if (!id) return;
      setRepCompany(id);
      setQbCompany(id);
      applySelectedProfileToPaper(id);
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
      var payload = {
        version: 1,
        companies: (profiles.companies || []).map(function (c) {
          return {
            id: c.id,
            caseNumber: c.caseNumber || '',
            courtDistrict: c.courtDistrict || '',
            courtDivision: c.courtDivision || '',
            responsiblePartyName: c.responsiblePartyName || '',
            naicsCode: c.naicsCode || '',
            lineOfBusiness: c.lineOfBusiness || ''
          };
        })
      };
      localStorage.setItem(PROFILE_LOCAL_KEY, JSON.stringify(payload));
      if (typeof window.erpShowToast === 'function') window.erpShowToast('✅ Profiles saved');
      setBankLoadMsg('✅ Profiles saved locally.');
      try {
        await fetch('/api/form-425c/profiles', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profiles)
        }).catch(function () {
          return null;
        });
      } catch (_) {
        // local profile save is source of truth
      }
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
        nextMonthProjectedReceipts: report.nextMonthProjectedReceipts,
        nextMonthProjectedDisbursements: report.nextMonthProjectedDisbursements,
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
          nextMonthProjectedReceipts:
            data.nextMonthProjectedReceipts != null
              ? String(data.nextMonthProjectedReceipts)
              : r.nextMonthProjectedReceipts,
          nextMonthProjectedDisbursements:
            data.nextMonthProjectedDisbursements != null
              ? String(data.nextMonthProjectedDisbursements)
              : r.nextMonthProjectedDisbursements,
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
      var payload = gatherReportPayload();
      saveReportToLocal(repCompany, repMonth, payload);
      setReceiptMsg('✅ Saved');
      if (typeof window.erpShowToast === 'function') window.erpShowToast('✅ Saved');
      try {
        var body = { companyId: repCompany, month: repMonth, ...payload };
        await fetch('/api/form-425c/saved-report', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).catch(function () { return null; });
        refreshHistory();
      } catch (_) {
        // local save is source of truth
      }
    }

    async function loadSavedReport(companyId, month) {
      var localSaved = loadReportFromLocal(companyId, month);
      if (localSaved && localSaved.report) {
        var localRep = localSaved.report;
        setRepCompany(localSaved.companyId || companyId);
        setRepMonth(localSaved.month || month);
        applyReportPayload(localRep);
        setReceiptMsg('📂 Restored from ' + (localSaved.month || month));
        if (typeof window.erpShowToast === 'function') window.erpShowToast('📂 Restored from ' + (localSaved.month || month));
        return;
      }
      var r = await fetch(
        '/api/form-425c/saved-report?' + new URLSearchParams({ companyId: companyId, month: month })
      );
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Not found');
      var rep = d.report;
      setRepCompany(rep.companyId || companyId);
      setRepMonth(rep.month || month);
      applyReportPayload(rep);
      saveReportToLocal(rep.companyId || companyId, rep.month || month, rep);
      setReceiptMsg('📂 Restored from ' + (rep.month || month));
      if (typeof window.erpShowToast === 'function') window.erpShowToast('📂 Restored from ' + (rep.month || month));
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

    function updateMergeFiles(kind, fileList) {
      var arr = Array.prototype.slice.call(fileList || []);
      setMergeFiles(function (m) {
        return { ...m, [kind]: arr };
      });
      setReport(function (r) {
        var att = { ...r.attachments };
        if (kind === 'pl') att.pl = arr.length > 0;
        if (kind === 'bankStmt') att.bankStmt = arr.length > 0;
        if (kind === 'bankRec') att.bankRec = arr.length > 0;
        return { ...r, attachments: att };
      });
    }

    function collectMergeFiles() {
      var all = [];
      var plFiles = mergeFiles.pl || [];
      var bankStmtFiles = mergeFiles.bankStmt || [];
      var bankRecFiles = mergeFiles.bankRec || [];
      plFiles.forEach(function (f) {
        all.push({ type: 'pl', file: f });
      });
      bankStmtFiles.forEach(function (f) {
        all.push({ type: 'bankStmt', file: f });
      });
      bankRecFiles.forEach(function (f) {
        all.push({ type: 'bankRec', file: f });
      });
      return all;
    }

    function printWithPackageNotes() {
      setReceiptMsg('After printing the form, attach your P&L and bank statements as separate pages.');
      if (typeof window.erpShowToast === 'function') {
        window.erpShowToast('Print tip: disable browser headers/footers in print settings.');
      }
      setTimeout(function () {
        window.print();
      }, 80);
    }

    function downloadPackageChecklist() {
      var bankNames = (mergeFiles.bankStmt || []).map(function (f) {
        return '  - ' + f.name;
      });
      var lines = [
        '✅ Form 425C — completed',
        (mergeFiles.pl || []).length ? '✅ Profit & Loss statement' : '☐ Profit & Loss statement',
        (mergeFiles.bankStmt || []).length
          ? '✅ Bank statements (attached):\n' + bankNames.join('\n')
          : '☐ Bank statements (list each account)',
        (mergeFiles.bankRec || []).length ? '✅ Bank reconciliation' : '☐ Bank reconciliation',
        report.attachments.ar ? '✅ Accounts receivable aging' : '☐ Accounts receivable aging',
        report.attachments.ap ? '✅ Accounts payable detail' : '☐ Accounts payable detail'
      ];
      setMergeMsg(lines.join('\n'));
    }

    async function downloadPackageZip() {
      var files = collectMergeFiles();
      if (!files.length) {
        setMergeMsg('Upload at least one attachment (P&L, bank statements, or bank reconciliation).');
        return;
      }
      var fd = new FormData();
      files.forEach(function (row) {
        fd.append('files', row.file, row.file.name);
      });
      fd.append(
        'manifestJson',
        JSON.stringify({
          companyId: repCompany,
          month: repMonth,
          attachmentsChecklist: report.attachments,
          generatedWith: 'IH35 Form 425C workspace',
          attachmentSummary: {
            pl: (mergeFiles.pl || []).map(function (f) {
              return f.name;
            }),
            bankStatements: (mergeFiles.bankStmt || []).map(function (f) {
              return f.name;
            }),
            bankReconciliation: (mergeFiles.bankRec || []).map(function (f) {
              return f.name;
            })
          }
        })
      );
      setMergeMsg('Building ZIP…');
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
        (profiles.companies || []).filter(function (c) { return c.id === repCompany; }).map(function (c) {
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
            h('input', {
              readOnly: true,
              value:
                ((profiles.companies || []).find(function (c) {
                  return c.id === repCompany;
                }) || {}).displayName || repCompany || ''
            })
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
            h('input', {
              readOnly: true,
              value:
                ((profiles.companies || []).find(function (c) {
                  return c.id === repCompany;
                }) || {}).displayName || repCompany || ''
            })
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
          h('button', { type: 'button', className: 'btn secondary', onClick: printWithPackageNotes }, 'Print / Save as PDF')
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
                h('input', makeMoneyInputProps(key, report[key], function (v) {
                  setReport(function (r) {
                    return { ...r, [key]: v };
                  });
                }, false))
              );
            }),
            h(
              'label',
              null,
              '22. Net cash flow',
              h('input', {
                className: 'f425-money f425-calculated',
                readOnly: true,
                value: fmtAccounting(report.line22)
              })
            ),
            h(
              'label',
              null,
              '23. Ending cash',
              h('input', {
                className: 'f425-money f425-calculated',
                readOnly: true,
                value: fmtAccounting(report.line23)
              })
            )
          ),
          h(
            'div',
            { className: 'no-print' },
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
                    h('input', Object.assign({}, makeMoneyInputProps('exd-' + ix, row.amount, function (v) {
                      setExhibitD(
                        exhibitD.map(function (r, j) {
                          return j === ix ? { ...r, amount: v } : r;
                        })
                      );
                    }, false), { style: { width: '100%', boxSizing: 'border-box' } }))
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
              var money = k !== 'line26' && k !== 'line27';
              return h(
                'label',
                { key: k },
                lab,
                money
                  ? h('input', makeMoneyInputProps(k, report[k], function (v) {
                      setReport(function (r) {
                        return { ...r, [k]: v };
                      });
                    }, false))
                  : h('input', {
                      value: report[k],
                      onChange: function (e) {
                        var v = e.target.value;
                        setReport(function (r) {
                          return { ...r, [k]: v };
                        });
                      }
                    })
              );
            })
          ),

          h('h3', { className: 'f425-h3' }, 'Part 7 — Section 7 (Projected vs Actual)'),
          (function () {
            var p32 = report.projections['32'] || { prior: '', current: '', next: '' };
            var p33 = report.projections['33'] || { prior: '', current: '', next: '' };
            var a32 = toNumber(p32.prior);
            var b32 = toNumber(report.line20);
            var c32 = Math.round((a32 - b32) * 100) / 100;
            var a33 = toNumber(p33.prior);
            var b33 = toNumber(report.line21);
            var c33 = Math.round((a33 - b33) * 100) / 100;
            var a34 = Math.round((a32 - a33) * 100) / 100;
            var b34 = toNumber(report.line22);
            var c34 = Math.round((a34 - b34) * 100) / 100;
            var nextReceipts = toNumber(report.nextMonthProjectedReceipts);
            var nextDisb = toNumber(report.nextMonthProjectedDisbursements);
            var nextNet = Math.round((nextReceipts - nextDisb) * 100) / 100;

            var onProjected = function (line) {
              return function (v) {
                setReport(function (r) {
                  var proj = { ...r.projections };
                  proj[line] = { ...proj[line], prior: v };
                  return { ...r, projections: proj };
                });
              };
            };

            return h(
              React.Fragment,
              null,
              h(
                'table',
                { className: 'f425-table f425-proj-table', style: { tableLayout: 'fixed', width: '100%' } },
                h('thead', null, h('tr', null,
                  h('th', null, 'Line / description'),
                  h('th', { style: { textAlign: 'center' } }, 'Column A — Projected'),
                  h('th', { style: { textAlign: 'center' } }, 'Column B — Actual'),
                  h('th', { style: { textAlign: 'center' } }, 'Column C — Difference')
                )),
                h('tbody', null,
                  h('tr', null,
                    h('td', null, h('strong', null, '32'), ' · Projected/Actual gross receipts / cash inflows'),
                    h('td', null, h('input', makeMoneyInputProps('p32a', p32.prior, onProjected('32'), false))),
                    h('td', null,
                      h('input', { className: 'f425-money f425-calculated', readOnly: true, value: fmtAccounting(b32) }),
                      h('div', { className: 'f425-note tiny' }, 'From line 20')
                    ),
                    h('td', null, h('input', { className: 'f425-money f425-calculated', readOnly: true, value: fmtAccounting(c32) }))
                  ),
                  h('tr', null,
                    h('td', null, h('strong', null, '33'), ' · Projected/Actual total cash disbursements'),
                    h('td', null, h('input', makeMoneyInputProps('p33a', p33.prior, onProjected('33'), false))),
                    h('td', null,
                      h('input', { className: 'f425-money f425-calculated', readOnly: true, value: fmtAccounting(b33) }),
                      h('div', { className: 'f425-note tiny' }, 'From line 21')
                    ),
                    h('td', null, h('input', { className: 'f425-money f425-calculated', readOnly: true, value: fmtAccounting(c33) }))
                  ),
                  h('tr', null,
                    h('td', null, h('strong', null, '34'), ' · Net cash flow (Row 32 minus Row 33)'),
                    h('td', null, h('input', { className: 'f425-money f425-calculated', readOnly: true, value: fmtAccounting(a34) })),
                    h('td', null,
                      h('input', { className: 'f425-money f425-calculated', readOnly: true, value: fmtAccounting(b34) }),
                      h('div', { className: 'f425-note tiny' }, 'From line 22')
                    ),
                    h('td', null, h('input', { className: 'f425-money f425-calculated', readOnly: true, value: fmtAccounting(c34) }))
                  )
                )
              ),
              h('h4', { className: 'f425-h3', style: { marginTop: 12 } }, 'Next month projections (for next report)'),
              h('div', { className: 'f425-grid' },
                h('label', null, 'Projected gross receipts next month', h('input', makeMoneyInputProps('nextReceipts', report.nextMonthProjectedReceipts, function (v) {
                  setReport(function (r) { return { ...r, nextMonthProjectedReceipts: v }; });
                }, false))),
                h('label', null, 'Projected total disbursements next month', h('input', makeMoneyInputProps('nextDisb', report.nextMonthProjectedDisbursements, function (v) {
                  setReport(function (r) { return { ...r, nextMonthProjectedDisbursements: v }; });
                }, false))),
                h('label', null, '37 · Projected net cash flow (next month)', h('input', {
                  className: 'f425-money f425-calculated',
                  readOnly: true,
                  value: fmtAccounting(nextNet)
                }))
              )
            );
          })(),
          h('h3', { className: 'f425-h3' }, 'Part 8 — Attachment checklist'),
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
          'p',
          { style: { marginTop: 10, fontSize: 12, color: 'var(--color-text-label)' } },
          'Attachments included: ',
          report.attachments.pl ? 'P&L, ' : '',
          report.attachments.bankStmt ? 'Bank statements, ' : '',
          report.attachments.bankRec ? 'Bank reconciliation, ' : '',
          report.attachments.ar ? 'AR aging, ' : '',
          report.attachments.ap ? 'AP detail' : ''
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
      var plNames = (mergeFiles.pl || []).map(function (f) {
        return f.name;
      });
      var bankStmtNames = (mergeFiles.bankStmt || []).map(function (f) {
        return f.name;
      });
      var bankRecNames = (mergeFiles.bankRec || []).map(function (f) {
        return f.name;
      });
      var anyFiles = plNames.length || bankStmtNames.length || bankRecNames.length;

      return h(
        'section',
        { id: 'panel-merge', className: 'f425-panel' + (tab === 'merge' ? ' active' : '') },
        h('h2', { className: 'f425-h2' }, 'Merge & export — filing package (.zip)'),
        h(
          'p',
          { className: 'f425-note' },
          'Print Form 425C first, then attach your P&L and bank statement pages as separate exhibits.'
        ),
        h(
          'div',
          { className: 'f425-grid', style: { marginBottom: 12 } },
          h(
            'label',
            { style: { display: 'block', fontSize: 13 } },
            'P&L Statement (Cash or Accrual basis)',
            h('div', { className: 'f425-note', style: { marginBottom: 4 } }, 'Export from QuickBooks → Reports → P&L'),
            h('input', {
              ref: plFileRef,
              type: 'file',
              accept: 'application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png',
              className: 'no-print',
              onChange: function (e) {
                updateMergeFiles('pl', e.target.files);
              }
            })
          ),
          h(
            'label',
            { style: { display: 'block', fontSize: 13 } },
            'Bank Statements (all DIP accounts)',
            h('input', {
              ref: bankStmtRef,
              type: 'file',
              multiple: true,
              accept: 'application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png',
              className: 'no-print',
              onChange: function (e) {
                updateMergeFiles('bankStmt', e.target.files);
              }
            })
          ),
          h(
            'label',
            { style: { display: 'block', fontSize: 13 } },
            'Bank Reconciliation Reports',
            h('input', {
              ref: bankRecRef,
              type: 'file',
              multiple: true,
              accept: 'application/pdf,.pdf',
              className: 'no-print',
              onChange: function (e) {
                updateMergeFiles('bankRec', e.target.files);
              }
            })
          )
        ),
        anyFiles
          ? h(
              'div',
              { className: 'f425-note', style: { marginBottom: 8, whiteSpace: 'pre-wrap' } },
              'Combined preview (selected files):\n' +
                (plNames.length ? 'P&L: ' + plNames.join(', ') + '\n' : '') +
                (bankStmtNames.length ? 'Bank statements: ' + bankStmtNames.join(', ') + '\n' : '') +
                (bankRecNames.length ? 'Bank reconciliation: ' + bankRecNames.join(', ') : '')
            )
          : h('p', { className: 'f425-note' }, 'No attachments selected yet.'),
        h(
          'div',
          { className: 'f425-actions' },
          h('button', { type: 'button', className: 'btn secondary', onClick: printWithPackageNotes }, 'Print / Save as PDF'),
          h('button', { type: 'button', className: 'btn secondary', onClick: downloadPackageChecklist }, 'Download package checklist'),
          h('button', { type: 'button', className: 'btn primary', onClick: downloadPackageZip }, 'Download ZIP package')
        ),
        h('p', { className: 'f425-note', style: { whiteSpace: 'pre-wrap' } }, mergeMsg)
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
          'div',
          { className: 'no-print', style: { margin: '6px 0 10px' } },
          h('label', { style: { display: 'block', fontSize: 12, color: 'var(--color-text-label)' } },
            'Active debtor',
            h(
              'select',
              {
                id: 'activeDebtor',
                value: repCompany,
                onChange: function (e) {
                  switchDebtor(e.target.value);
                }
              },
              h('option', { value: 'ih35-transportation' }, 'IH 35 Transportation LLC'),
              h('option', { value: 'ih35-trucking' }, 'IH 35 Trucking LLC')
            )
          )
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
  var rootEl = document.getElementById('root');
  if (rootEl) {
    if (window.ReactDOM && typeof window.ReactDOM.createRoot === 'function') {
      window.ReactDOM.createRoot(rootEl).render(React.createElement(Form425CApp, null));
    } else if (window.ReactDOM && typeof window.ReactDOM.render === 'function') {
      window.ReactDOM.render(React.createElement(Form425CApp, null), rootEl);
    } else {
      console.error('Form 425C: ReactDOM mount API unavailable');
    }
  } else {
    console.error('Form 425C: missing #root mount node');
  }
})();
