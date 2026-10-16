import { Logo } from "@/components/logo";
import { Link, useLocation } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { PRIMARY_NAV, SETTINGS_NAV, activeSection, type NavItem } from "./nav";
import { prefetchRoute } from "./prefetch";

function NavEntry({ item, active }: { item: NavItem; active: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
        size="lg"
        className="h-10 text-body group-data-[collapsible=icon]:justify-center"
      >
        <Link
          to={item.to}
          aria-current={active ? "page" : undefined}
          aria-label={item.label}
          onClick={() => isMobile && setOpenMobile(false)}
          // The page's code starts loading before the click (roadmap 7.1).
          onPointerEnter={() => prefetchRoute(item.id)}
          onFocus={() => prefetchRoute(item.id)}
        >
          <item.icon aria-hidden className="size-[18px] shrink-0" />
          {/* Icon-only rail: the label is hidden (the tooltip and aria-label keep the name). */}
          <span className="truncate group-data-[collapsible=icon]:hidden">{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const location = useLocation();
  const current = activeSection(location.pathname, (location.state as { section?: string } | null)?.section);

  return (
    <Sidebar collapsible="icon">
      {/* The shadcn sidebar is a div; this nav makes it a labelled landmark so nothing sits outside one. */}
      <nav aria-label="Main navigation" className="flex h-full w-full flex-col">
        {/* Part of the title bar in the desktop app: its empty space drags the window. */}
        <SidebarHeader data-tauri-drag-region className="h-14 justify-center border-b">
          <Link to="/" className="flex items-center gap-2 px-2 font-semibold tracking-tight">
            <Logo className="size-6" />
            <span className="truncate group-data-[collapsible=icon]:hidden">ClearPractice</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {PRIMARY_NAV.map((item) => (
                  <NavEntry key={item.id} item={item} active={current === item.id} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <NavEntry item={SETTINGS_NAV} active={current === "settings"} />
          </SidebarMenu>
        </SidebarFooter>
      </nav>
    </Sidebar>
  );
}
