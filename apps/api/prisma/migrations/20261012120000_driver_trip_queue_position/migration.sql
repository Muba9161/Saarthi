-- A driver's own trips can be reordered: their place in the queue on the vehicle.
ALTER TABLE "trips" ADD COLUMN "queuePosition" INTEGER;
