-- Reference only — the admin controller's install() runs this automatically
-- when the extension is installed via Admin → Extensions → Extensions (type: Modules).
-- Keep here in case manual install via phpMyAdmin is ever needed.

CREATE TABLE IF NOT EXISTS `oc_order_halotrack` (
  `order_id` INT(11) NOT NULL,
  `session_id` VARCHAR(64) NULL,
  `customer_ip` VARCHAR(45) NULL,
  `forwarded_at` DATETIME NULL,
  PRIMARY KEY (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
