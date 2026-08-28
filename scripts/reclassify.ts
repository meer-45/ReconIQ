import { prisma, closePrisma } from "../src/persistence/db";

const ids = [
  "ss_ex_tx_l3poge24r5a",
  "ss_ex_tx_lr5wwbfyt4",
  "ss_ex_tx_s4bmvi97tp",
];

for (const id of ids) {
  await prisma.unresolvedException.update({
    where: { unresolvedExceptionId: id },
    data: { classification: "AMBIGUOUS_MATCH" },
  });
  console.log("reclassified", id);
}

await closePrisma();
