import React, { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Frame, Navigation, TopBar, Banner } from "@shopify/polaris";
import {
  HomeIcon,
  ConnectIcon,
  ShieldCheckMarkIcon,
  ThemeIcon,
  ListBulletedIcon,
  CameraIcon,
  AppsIcon,
  HeartIcon,
  LockIcon,
  MagicIcon,
  NoteIcon,
  PersonIcon,
  PaintBrushFlatIcon,
  ClipboardChecklistIcon,
  ChartVerticalIcon,
} from "@shopify/polaris-icons";
import { useSession } from "../lib/session";
import { ToastOutlet } from "../lib/toast";
import { EntitlementBadge } from "./badges";

const NAV_ITEMS = [
  { label: "Home", path: "/", icon: HomeIcon },
  { label: "Connect", path: "/connect", icon: ConnectIcon },
  { label: "Safety", path: "/safety", icon: ShieldCheckMarkIcon },
  { label: "Theme", path: "/theme", icon: ThemeIcon },
  { label: "Design", path: "/design", icon: PaintBrushFlatIcon },
  { label: "Ledger", path: "/ledger", icon: ListBulletedIcon },
  { label: "Reports", path: "/reports", icon: ChartVerticalIcon },
  { label: "Snapshots", path: "/snapshots", icon: CameraIcon },
  { label: "Apps", path: "/apps", icon: AppsIcon },
  { label: "Diagnostics", path: "/diagnostics", icon: HeartIcon },
  { label: "Privacy", path: "/privacy", icon: LockIcon },
  { label: "Skills", path: "/skills", icon: MagicIcon },
  { label: "Memory", path: "/memory", icon: NoteIcon },
  { label: "Account", path: "/account", icon: PersonIcon },
  { label: "Setup", path: "/onboarding", icon: ClipboardChecklistIcon },
];

export function AppFrame() {
  const [mobileNavActive, setMobileNavActive] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useSession();

  const navigation = (
    <Navigation location={location.pathname}>
      <Navigation.Section
        items={NAV_ITEMS.map((item) => ({
          label: item.label,
          icon: item.icon,
          selected: item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path),
          onClick: () => {
            navigate(item.path);
            setMobileNavActive(false);
          },
        }))}
      />
    </Navigation>
  );

  const topBarMarkup = (
    <TopBar
      showNavigationToggle
      onNavigationToggle={() => setMobileNavActive((v) => !v)}
      secondaryMenu={
        session ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 12 }}>
            <EntitlementBadge state={session.entitlement.state} />
          </div>
        ) : undefined
      }
    />
  );

  return (
    <Frame
      topBar={topBarMarkup}
      navigation={navigation}
      showMobileNavigation={mobileNavActive}
      onNavigationDismiss={() => setMobileNavActive(false)}
    >
      {session?.demo ? (
        <div style={{ padding: "12px 20px 0" }}>
          <Banner tone="info" title="Demo mode">
            <p>You're viewing ShopManager AI with a demo shop. No real Shopify data is being read or changed.</p>
          </Banner>
        </div>
      ) : null}
      <Outlet />
      <ToastOutlet />
    </Frame>
  );
}
