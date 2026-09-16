import React from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { AppFrame } from "./components/AppFrame";
import { Home } from "./routes/Home";
import { Connect } from "./routes/Connect";
import { Safety } from "./routes/Safety";
import { Theme } from "./routes/Theme";
import { Ledger } from "./routes/Ledger";
import { LedgerDetail } from "./routes/LedgerDetail";
import { Snapshots } from "./routes/Snapshots";
import { Apps } from "./routes/Apps";
import { Diagnostics } from "./routes/Diagnostics";
import { Privacy } from "./routes/Privacy";
import { Skills } from "./routes/Skills";
import { Memory } from "./routes/Memory";
import { Account } from "./routes/Account";
import { Design } from "./routes/Design";
import { Onboarding } from "./routes/Onboarding";
import { Reports, ReportDetail } from "./routes/Reports";

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppFrame />}>
          <Route path="/" element={<Home />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/safety" element={<Safety />} />
          <Route path="/theme" element={<Theme />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/ledger/:id" element={<LedgerDetail />} />
          <Route path="/snapshots" element={<Snapshots />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/diagnostics" element={<Diagnostics />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/memory" element={<Memory />} />
          <Route path="/account" element={<Account />} />
          <Route path="/design" element={<Design />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:jobId" element={<ReportDetail />} />
          <Route path="/onboarding" element={<Onboarding />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
