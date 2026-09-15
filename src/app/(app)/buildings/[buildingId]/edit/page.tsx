import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArchiveBuilding } from "@/components/buildings/archive-building";
import { BuildingForm } from "@/components/buildings/building-form";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { buildingFields } from "@/lib/building-form";
import { buildingName } from "@/lib/buildings";
import { getBuilding } from "@/server/queries/buildings";

/**
 * `docs/ui/screens/building-form.md`, for a building that exists: the same
 * form, prefilled exactly — an untouched save writes back what it read — and
 * the archive control at its foot.
 */
export async function generateMetadata({
  params,
}: PageProps<"/buildings/[buildingId]/edit">): Promise<Metadata> {
  const detail = await getBuilding((await params).buildingId);

  return {
    title: detail
      ? `Edit ${buildingName(detail.building)} — CapExWise`
      : "Not found — CapExWise",
  };
}

export default async function EditBuildingPage({
  params,
}: PageProps<"/buildings/[buildingId]/edit">) {
  const detail = await getBuilding((await params).buildingId);
  if (!detail) notFound();

  const { building, units } = detail;
  const name = buildingName(building);

  return (
    <>
      <PageHeader
        title={`Edit ${name}`}
        subtitle="Address, units, and what you paid"
      />
      <PageBody>
        <div className="flex flex-col gap-10">
          <BuildingForm
            mode={{ kind: "edit", buildingId: building.id }}
            initial={buildingFields(building, units)}
            historic={units
              .filter((unit) => unit.hasRentHistory)
              .map((unit) => unit.id)}
            equipped={units
              .filter((unit) => unit.hasEquipment)
              .map((unit) => unit.id)}
          />
          {building.status === "sold" ? null : (
            <ArchiveBuilding
              buildingId={building.id}
              name={name}
              status={building.status}
            />
          )}
        </div>
      </PageBody>
    </>
  );
}
