import { useEffect, useState } from "react";
import { showToast } from "../ui/Toast";

interface QboAccount { qboId: string; name: string; accountType: string; }
interface QboItem { qboId: string; name: string; }

export function FuelSettingsPage() {
  const [accounts, setAccounts] = useState<QboAccount[]>([]);
  const [items, setItems] = useState<QboItem[]>([]);
  const [truckAccount, setTruckAccount] = useState("");
  const [truckItem, setTruckItem] = useState("");
  const [reeferAccount, setReeferAccount] = useState("");
  const [reeferItem, setReeferItem] = useState("");
  const [defAccount, setDefAccount] = useState("");
  const [defItem, setDefItem] = useState("");
  const [status, setStatus] = useState<Record<string,string>>({});

  useEffect(() => {
    fetch("/api/qbo/master").then(r=>r.json()).then(d=>{
      setAccounts(d.accountsExpense||d.accounts||[]);
      setItems(d.items||[]);
    });
    fetch("/api/fuel/settings").then(r=>r.json()).then(d=>{
      (d.settings||[]).forEach((s:any)=>{
        if(s.fuel_type==="truck_diesel"){ setTruckAccount(s.qbo_account_name||""); setTruckItem(s.qbo_item_name||""); }
        if(s.fuel_type==="reefer_diesel"){ setReeferAccount(s.qbo_account_name||""); setReeferItem(s.qbo_item_name||""); }
        if(s.fuel_type==="def"){ setDefAccount(s.qbo_account_name||""); setDefItem(s.qbo_item_name||""); }
      });
    });
  }, []);

  const inputStyle: React.CSSProperties = {
    width:"100%", padding:"10px 12px", background:"#1a1f2e",
    border:"1px solid rgba(255,255,255,0.15)", borderRadius:"6px",
    color:"#e2e8f0", fontSize:"13px", boxSizing:"border-box", marginTop:"4px"
  };

  const saveRow = async (fuelType: string, accountVal: string, itemVal: string) => {
    const found = accounts.find(a => a.name === accountVal);
    const foundItem = items.find(i => i.name === itemVal);
    try {
      const r = await fetch("/api/fuel/settings", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          fuel_type: fuelType,
          qbo_account_id: found?.qboId||"",
          qbo_account_name: accountVal,
          qbo_item_id: foundItem?.qboId||"",
          qbo_item_name: itemVal
        })
      });
      const d = await r.json();
      if(d.ok){
        setStatus(p=>({...p,[fuelType]:"saved"}));
        showToast("\u2705 " + fuelType.replace("_"," ") + " mapping saved","success");
        setTimeout(()=>setStatus(p=>({...p,[fuelType]:""})),3000);
      } else {
        setStatus(p=>({...p,[fuelType]:"error"}));
        showToast("\u274c Error saving","error");
      }
    } catch {
      setStatus(p=>({...p,[fuelType]:"error"}));
      showToast("\u274c Error saving","error");
    }
  };

  const Row = ({title, fuelType, account, setAccount, item, setItem}: any) => (
    <div style={{marginBottom:"24px",paddingBottom:"24px",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
      <div style={{fontWeight:600,fontSize:"15px",color:"#e2e8f0",marginBottom:"12px"}}>{title}</div>
      <div style={{marginBottom:"8px"}}>
        <label style={{fontSize:"12px",color:"#8892a4"}}>QBO Expense Account</label>
        <input type="text" list={"accts_"+fuelType} value={account}
          onChange={e=>setAccount(e.target.value)} style={inputStyle}
          placeholder="Type to search accounts..." />
        <datalist id={"accts_"+fuelType}>
          {accounts.map(a=><option key={a.qboId} value={a.name}/>)}
        </datalist>
      </div>
      <div style={{marginBottom:"12px"}}>
        <label style={{fontSize:"12px",color:"#8892a4"}}>QBO Item (optional)</label>
        <input type="text" list={"items_"+fuelType} value={item}
          onChange={e=>setItem(e.target.value)} style={inputStyle}
          placeholder="Type to search items..." />
        <datalist id={"items_"+fuelType}>
          {items.map(i=><option key={i.qboId} value={i.name}/>)}
        </datalist>
      </div>
      <button onClick={()=>saveRow(fuelType,account,item)}
        style={{padding:"8px 20px",background:"#3b82f6",color:"#fff",border:"none",
                borderRadius:"6px",fontSize:"13px",fontWeight:500,cursor:"pointer"}}>
        Save
      </button>
      {status[fuelType]==="saved" && <span style={{marginLeft:"12px",color:"#22c55e",fontSize:"13px"}}>\u2705 Saved</span>}
      {status[fuelType]==="error" && <span style={{marginLeft:"12px",color:"#ef4444",fontSize:"13px"}}>\u274c Error</span>}
    </div>
  );

  return (
    <div style={{padding:"24px",maxWidth:"700px"}}>
      <h2 style={{color:"#e2e8f0",marginBottom:"4px"}}>Fuel settings</h2>
      <p style={{color:"#8892a4",fontSize:"13px",marginBottom:"24px"}}>
        Map driver fuel types to QuickBooks accounts/items for auto-posting.
      </p>
      <Row title="\u26fd Truck Diesel" fuelType="truck_diesel"
        account={truckAccount} setAccount={setTruckAccount}
        item={truckItem} setItem={setTruckItem} />
      <Row title="\u2744\ufe0f Reefer Diesel" fuelType="reefer_diesel"
        account={reeferAccount} setAccount={setReeferAccount}
        item={reeferItem} setItem={setReeferItem} />
      <Row title="\U0001f7e6 DEF" fuelType="def"
        account={defAccount} setAccount={setDefAccount}
        item={defItem} setItem={setDefItem} />
    </div>
  );
}
