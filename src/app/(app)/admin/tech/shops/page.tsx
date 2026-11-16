import { BadgeCheck, Plus } from "lucide-react";
import type { Metadata } from "next";
import { ActionButton, ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { screen } from "@/components/shell/skeleton";
import { buttonClass, Card, EmptyState, Field, Notice, PageHeader, Pill } from "@/components/ui";
import type { Shop } from "@/db/schema";
import { plural } from "@/lib/cn";
import { requireAdmin } from "@/server/auth";
import { listInspections, listShops, matchShop } from "@/server/tech";
import { saveShop, setShopVerified } from "../actions";

export const metadata: Metadata = { title: "Shops" };

function ShopFields({ shop }: { shop?: Shop }) {
  return (
    <div className="space-y-3">
      {shop ? <input type="hidden" name="id" value={shop.id} /> : null}
      <Field label="Shop name">
        <input name="name" required className="ctl" defaultValue={shop?.name ?? ""} autoComplete="off" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact or lead technician" optional>
          <input name="contactName" className="ctl" defaultValue={shop?.contactName ?? ""} autoComplete="off" />
        </Field>
        <Field label="City" optional>
          <input name="city" className="ctl" defaultValue={shop?.city ?? ""} autoComplete="off" />
        </Field>
      </div>
      <Field label="Email" hint="Inspection links for this shop are only ever sent here. Use an address you have confirmed with the shop.">
        <input name="email" type="email" inputMode="email" className="ctl" defaultValue={shop?.email ?? ""} autoComplete="off" />
      </Field>
      <Field label="Phone" optional>
        <input name="phone" type="tel" inputMode="tel" className="ctl" defaultValue={shop?.phone ?? ""} autoComplete="off" />
      </Field>
      <Field label="Notes" optional>
        <textarea name="notes" className="ctl min-h-20" defaultValue={shop?.notes ?? ""} />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] bg-paper px-3.5 py-3 text-[15px]">
        <input type="checkbox" name="verified" className="check mt-0.5" defaultChecked={shop?.verified ?? false} />
        <span>
          <span className="block font-semibold">Verified shop</span>
          <span className="block text-ink-2">The region has confirmed this shop and its email address. Its online sign-offs are trusted, and drivers can pick it from the list.</span>
        </span>
      </label>
      <SubmitButton className="w-full" pendingLabel="Saving…">
        {shop ? "Save shop" : "Add shop"}
      </SubmitButton>
    </div>
  );
}

export default screen(async function ShopsPage() {
  const v = await requireAdmin();
  const [shops, inspections] = await Promise.all([listShops(v.org.id), v.event ? listInspections(v.event.id) : Promise.resolve([])]);
  const uses = new Map<string, number>();
  for (const i of inspections) {
    const shop = i.method === "online" ? matchShop(i, shops) : null;
    if (shop) uses.set(shop.id, (uses.get(shop.id) ?? 0) + 1);
  }
  const unverified = shops.filter((x) => !x.verified);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={{ href: "/admin/tech", label: "Tech inspection" }}
        title="Shops"
        lede="The shops the region knows. A verified shop's online sign-off is trusted because its inspection link only ever goes to the email address on file here."
        actions={
          <Sheet
            trigger={
              <>
                <Plus className="size-4" /> Add shop
              </>
            }
            triggerClassName={buttonClass("primary", "md")}
            title="Add a shop"
          >
            <ActionForm action={saveShop}>
              <ShopFields />
            </ActionForm>
          </Sheet>
        }
      />

      {unverified.length ? (
        <Notice tone="warn" className="mb-4" title={`${plural(unverified.length, "shop")} waiting to be verified`}>
          Drivers added {unverified.length === 1 ? "this shop" : "these shops"} when sending their tech forms. Call the shop to confirm the email address belongs to them, then mark it verified.
        </Notice>
      ) : null}

      {shops.length === 0 ? (
        <EmptyState title="No shops yet">Add the shops your members use, so drivers can send them the inspection form in two taps.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {shops.map((shop) => (
            <li key={shop.id}>
              <Card className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <p className="text-lg leading-tight font-bold">{shop.name}</p>
                    <p className="text-sm text-ink-2">{[shop.contactName, shop.city].filter(Boolean).join(" · ") || "No contact on file"}</p>
                  </div>
                  {shop.verified ? (
                    <Pill tone="good">
                      <BadgeCheck className="size-3.5" /> Verified
                    </Pill>
                  ) : (
                    <Pill tone="warn">Not verified</Pill>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
                  {shop.email ? (
                    <a href={`mailto:${shop.email}`} className="break-all underline underline-offset-4">
                      {shop.email}
                    </a>
                  ) : (
                    <span className="text-ink-3">No email on file</span>
                  )}
                  {shop.phone ? (
                    <a href={`tel:${shop.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-4">
                      {shop.phone}
                    </a>
                  ) : null}
                </div>
                {shop.notes ? <p className="mt-2 text-[15px] text-ink-2">{shop.notes}</p> : null}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <Sheet trigger="Edit" triggerClassName={buttonClass("secondary", "sm")} triggerLabel={`Edit ${shop.name}`} title={shop.name}>
                    <ActionForm action={saveShop}>
                      <ShopFields shop={shop} />
                    </ActionForm>
                  </Sheet>
                  <ActionButton
                    action={setShopVerified.bind(null, shop.id, !shop.verified)}
                    size="sm"
                    confirm={shop.verified ? `Remove ${shop.name} from the verified list? Its future sign-offs will be flagged for review.` : `Mark ${shop.name} as verified? Only do this once you have confirmed ${shop.email ?? "its email address"} belongs to the shop.`}
                  >
                    {shop.verified ? "Remove verification" : "Mark verified"}
                  </ActionButton>
                  {uses.get(shop.id) ? <span className="ml-auto text-sm text-ink-2">{plural(uses.get(shop.id)!, "form")} this event</span> : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
