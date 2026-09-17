import { connection } from "next/server";
import { view } from "@/lib/hidden";
import { capabilities, describeAccelerator } from "@/lib/media/accel";
import { activeJobs } from "@/lib/media/transcode";

/** What the transcoder can use, and what it is doing right now. */
export async function GET() {
  await connection();
  const [{ ffmpeg, accelerators }, seen] = await Promise.all([capabilities(), view()]);
  return Response.json({
    ffmpeg,
    preferred: accelerators[0] ? describeAccelerator(accelerators[0]) : null,
    accelerators,
    // Jobs name their files, so a browser that has not unlocked hidden items does not see jobs on them.
    jobs: activeJobs().filter((job) => seen.canSee(job.file.split("/"))),
  });
}
