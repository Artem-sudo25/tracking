<?php
class ControllerExtensionModuleHalotrack extends Controller {
	// Fires on model/checkout/order/addOrder/after (see engine/loader.php's
	// automatic model-proxy event wrapping — no explicit event->trigger()
	// call needed in checkout/order.php itself).
	//
	// Wrapped in try/catch(\Throwable) because this runs inline inside the
	// customer's own checkout request — an uncaught error here would bubble
	// up through OpenCart's Event::trigger() (which does not catch runtime
	// errors, only missing-route Exceptions) and break checkout for that
	// customer. Any failure here must degrade to "tracking didn't fire",
	// never to "order didn't complete".
	public function orderCreated(&$route, &$args, &$output) {
		try {
			$this->handleOrderCreated($output);
		} catch (\Throwable $e) {
			$this->log->write('[HaloTrack] orderCreated failed: ' . $e->getMessage());
		}
	}

	// Fires on model/checkout/order/addOrderHistory/after — this may be a
	// completely different request than the one that created the order (bank/PSP
	// webhook, admin panel status change), which is why session_id was persisted
	// ahead of time in orderCreated() rather than read from cookies here.
	// Same try/catch rationale as orderCreated() — this also runs inline inside
	// the bank's payment-callback request and the admin's status-change request.
	public function orderStatusChanged(&$route, &$args, &$output) {
		try {
			$order_id = isset($args[0]) ? (int)$args[0] : 0;
			$order_status_id = isset($args[1]) ? (int)$args[1] : 0;

			$this->handleOrderStatusChanged($order_id, $order_status_id);
		} catch (\Throwable $e) {
			$this->log->write('[HaloTrack] orderStatusChanged failed: ' . $e->getMessage());
		}
	}

	private function handleOrderCreated($order_id) {
		if (!$this->config->get('module_halotrack_status')) {
			return;
		}

		if (!$order_id) {
			return;
		}

		$session_id = isset($this->request->cookie['_halo']) ? $this->request->cookie['_halo'] : '';
		$customer_ip = isset($this->request->server['REMOTE_ADDR']) ? $this->request->server['REMOTE_ADDR'] : '';

		$this->load->model('extension/module/halotrack');
		$this->model_extension_module_halotrack->captureSession($order_id, $session_id, $customer_ip);
	}

	private function handleOrderStatusChanged($order_id, $order_status_id) {
		if (!$this->config->get('module_halotrack_status')) {
			return;
		}

		if (!$order_id || !$order_status_id) {
			return;
		}

		$paid_status_ids = (array)$this->config->get('module_halotrack_order_status_ids');

		if (!in_array($order_status_id, $paid_status_ids)) {
			return;
		}

		$this->load->model('extension/module/halotrack');

		$record = $this->model_extension_module_halotrack->getRecord($order_id);

		if ($record && !empty($record['forwarded_at'])) {
			return;
		}

		$this->forwardOrder($order_id, $record);
	}

	private function forwardOrder($order_id, $record) {
		$halotrack_url = trim((string)$this->config->get('module_halotrack_url'), '/');
		$webhook_secret = (string)$this->config->get('module_halotrack_secret');

		if (!$halotrack_url || !$webhook_secret) {
			return;
		}

		$this->load->model('checkout/order');

		$order_info = $this->model_checkout_order->getOrder($order_id);

		if (!$order_info) {
			return;
		}

		// Re-check against the order's actual persisted status, not the status
		// id that was passed into addOrderHistory(). OpenCart's anti-fraud
		// checks can rewrite the applied status after the fact (e.g. payment
		// module requests "Processing", anti-fraud downgrades it to
		// "Suspicious Fraud") — the addOrderHistory/after event still fires
		// with the originally-requested id, so trusting $args[1] alone can
		// forward a purchase that was never actually confirmed.
		$paid_status_ids = (array)$this->config->get('module_halotrack_order_status_ids');
		$actual_status_id = (int)$order_info['order_status_id'];

		if (!in_array($actual_status_id, $paid_status_ids)) {
			return;
		}

		$items = array();

		foreach ($this->model_checkout_order->getOrderProducts($order_id) as $product) {
			$items[] = array(
				'id'       => (string)$product['product_id'],
				'name'     => $product['name'],
				'price'    => (float)$product['price'],
				'quantity' => (int)$product['quantity'],
			);
		}

		// Deliberately shaped to avoid the `billing` / `line_items` keys that
		// would route this into HaloTrack's WooCommerce normalizer branch —
		// this payload is meant to fall through to the generic/custom branch.
		$payload = array(
			'order_id'     => (string)$order_id,
			'platform'     => 'opencart',
			'total'        => (float)$order_info['total'],
			'currency'     => $order_info['currency_code'],
			'email'        => $order_info['email'],
			'phone'        => $order_info['telephone'],
			'customer_id'  => $order_info['customer_id'] ?: null,
			'session_id'   => $record ? $record['session_id'] : '',
			'items'        => $items,
			'ip_address'   => $record ? $record['customer_ip'] : '',
			'created_at'   => date('c', strtotime($order_info['date_added'])),
		);

		$body = json_encode($payload);
		$timestamp = (string)time();
		$signature = hash_hmac('sha256', $timestamp . '.' . $body, $webhook_secret);

		$ch = curl_init($halotrack_url . '/api/webhook/order');

		curl_setopt_array($ch, array(
			CURLOPT_POST           => true,
			CURLOPT_POSTFIELDS     => $body,
			CURLOPT_HTTPHEADER     => array(
				'Content-Type: application/json',
				'x-halo-timestamp: ' . $timestamp,
				'x-halo-signature: ' . $signature,
			),
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_CONNECTTIMEOUT => 2,
			CURLOPT_TIMEOUT        => 2,
		));

		$response = curl_exec($ch);
		$errno = curl_errno($ch);
		$error = curl_error($ch);
		$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		curl_close($ch);

		if ($errno) {
			$this->log->write('[HaloTrack] Order ' . $order_id . ' forward failed (curl): ' . $error);
			return;
		}

		if ($http_code >= 200 && $http_code < 300) {
			$this->model_extension_module_halotrack->markForwarded($order_id);
		} else {
			$this->log->write('[HaloTrack] Order ' . $order_id . ' forward failed — HTTP ' . $http_code . ': ' . $response);
		}
	}
}
