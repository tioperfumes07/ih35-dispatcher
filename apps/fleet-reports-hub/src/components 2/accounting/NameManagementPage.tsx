import { VendorDriverManagement } from './VendorDriverManagement'

/** Vendor & driver registry (list + detail): see VendorDriverManagement. */
export function NameManagementPage() {
  return (
    <div
      className="name-mgmt-page-root"
      role="main"
      aria-label="Vendor and driver name management"
    >
      <VendorDriverManagement />
    </div>
  )
}
