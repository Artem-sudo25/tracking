<?php
class ModelExtensionModuleHalotrack extends Model {
	public function captureSession($order_id, $session_id, $customer_ip) {
		$this->db->query("
			INSERT INTO `" . DB_PREFIX . "order_halotrack` SET
				`order_id` = '" . (int)$order_id . "',
				`session_id` = '" . $this->db->escape((string)$session_id) . "',
				`customer_ip` = '" . $this->db->escape((string)$customer_ip) . "'
			ON DUPLICATE KEY UPDATE
				`session_id` = IF(`session_id` = '' OR `session_id` IS NULL, VALUES(`session_id`), `session_id`),
				`customer_ip` = IF(`customer_ip` = '' OR `customer_ip` IS NULL, VALUES(`customer_ip`), `customer_ip`)
		");
	}

	public function getRecord($order_id) {
		$query = $this->db->query("
			SELECT * FROM `" . DB_PREFIX . "order_halotrack`
			WHERE `order_id` = '" . (int)$order_id . "'
		");

		return $query->row ?: null;
	}

	// Upsert, not a bare UPDATE: if captureSession() never ran for this order
	// (module was disabled at order-creation time, or an earlier error), a
	// plain UPDATE would silently affect 0 rows and forwarded_at would never
	// stick — causing the order to be re-sent on every later status change.
	public function markForwarded($order_id) {
		$this->db->query("
			INSERT INTO `" . DB_PREFIX . "order_halotrack` SET
				`order_id` = '" . (int)$order_id . "',
				`forwarded_at` = NOW()
			ON DUPLICATE KEY UPDATE
				`forwarded_at` = NOW()
		");
	}
}
