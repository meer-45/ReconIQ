import { prisma, closePrisma } from "../src/persistence/db";

const ids = [
  "ss_ex_tx_s4bmvi97tp",
  "ss_ex_tx_wcume4wn5p",
  "ss_ex_tx_vyismk47bp",
];

for (const id of ids) {
  await prisma.unresolvedException.update({
    where: { unresolvedExceptionId: id },
    data: { classification: "AMBIGUOUS_MATCH" },
  });
  console.log("reclassified", id);
}

await closePrisma();
