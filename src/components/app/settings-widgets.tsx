"use client";
import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { copyText } from "./copy-button";

function Reveal({ title, text, note, onClose }: { title: string; text: string; note: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={note}>
        <div className="flex gap-2">
          <code className="min-w-0 flex-1 break-all rounded-xl bg-mist px-3 py-2.5 text-xs">{text}</code>
          <Button size="sm" variant="secondary" aria-label="Copy" onClick={() => void copyText(text)}><Copy /></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function StaffInvite() {
  const [link, setLink] = useState<string | null>(null);
  return (
    <>
      <FormDialog trigger={<Button size="sm">Invite staff</Button>} title="Invite a team member" endpoint="/api/gym/staff" submitLabel="Create invite" successMessage="Invite created" onDone={(r) => setLink((r as { link: string }).link)} fields={[
        { name: "role", label: "Role", type: "select", required: true, options: [{ value: "STAFF", label: "Front desk staff" }, { value: "TRAINER", label: "Trainer" }, { value: "MANAGER", label: "Manager" }] },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Mobile", type: "tel" },
      ]} />
      {link && <Reveal title="Share this invite link" text={link} note="Send it to your team member. It works once and expires in 7 days." onClose={() => setLink(null)} />}
    </>
  );
}

export function DeviceCreate({ locations = [] }: { locations?: { id: string; name: string }[] }) {
  const [key, setKey] = useState<string | null>(null);
  return (
    <>
      <FormDialog trigger={<Button size="sm">Add device</Button>} title="Add check-in device" endpoint="/api/gym/devices" submitLabel="Create device" successMessage="Device created" onDone={(r) => setKey((r as { apiKey: string }).apiKey)} fields={[
        { name: "name", label: "Name", required: true, placeholder: "Front door reader" },
        { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "NFC_READER", label: "NFC card reader" }, { value: "KIOSK", label: "Kiosk" }] },
        ...(locations.length > 1 ? [{ name: "locationId", label: "Branch", type: "select" as const, required: true, defaultValue: locations[0]!.id, options: locations.map((l) => ({ value: l.id, label: l.name })) }] : []),
      ]} />
      {key && <Reveal title="Device key" text={key} note="Copy this key into the device now. For security, it won't be shown again." onClose={() => setKey(null)} />}
    </>
  );
}
